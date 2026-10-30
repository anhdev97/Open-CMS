import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { OAUTH2_DB } from '../constants';
import type { AuthTables, IdentityProviderHealthStatus } from '../db/types';
import { checkOidcDiscovery } from './oidc-discovery-client';

const PROBE_INTERVAL_MS = 5 * 60 * 1000;
const HEALTH_RETENTION_DAYS = 30;

export function classifyHealth(failures: number, successes: number, prior: IdentityProviderHealthStatus): IdentityProviderHealthStatus {
  if (failures >= 3) return 'UNAVAILABLE';
  if (failures > 0) return 'DEGRADED';
  if (successes >= 2 || prior === 'UNKNOWN') return 'HEALTHY';
  return prior === 'HEALTHY' ? 'HEALTHY' : 'DEGRADED';
}

/**
 * Health is advisory. No probe can disable SSO, publish a version or recover
 * a provider automatically. PostgreSQL advisory locks coordinate instances.
 */
@Injectable()
export class ProviderHealthService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;

  constructor(@Inject(OAUTH2_DB) private readonly db: Kysely<AuthTables>) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.probeAll().catch(() => { /* Do not interrupt local login on a health failure. */ });
    }, PROBE_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async probeAll(): Promise<void> {
    const providers = await this.db.selectFrom('auth_identity_providers')
      .select('id').where('lifecycle_status', '=', 'ACTIVE').execute();
    for (const provider of providers) {
      await this.probe(provider.id).catch(() => {});
    }
    await this.db.deleteFrom('auth_identity_provider_health_events')
      .where('at', '<', new Date(Date.now() - HEALTH_RETENTION_DAYS * 86_400_000)).execute();
  }

  async probe(providerId: string): Promise<IdentityProviderHealthStatus> {
    return this.db.transaction().execute(async (trx) => {
      const lock = await sql<{ acquired: boolean }>`
        select pg_try_advisory_xact_lock(1542636214, hashtext(${providerId})) as acquired
      `.execute(trx);
      if (!lock.rows[0]?.acquired) {
        const existing = await trx.selectFrom('auth_identity_provider_health').select('health_status')
          .where('provider_id', '=', providerId).executeTakeFirst();
        return existing?.health_status ?? 'UNKNOWN';
      }
      const provider = await trx.selectFrom('auth_identity_providers as p')
        .innerJoin('auth_identity_provider_versions as v', 'v.id', 'p.active_version_id')
        .select(['p.id', 'p.lifecycle_status', 'p.active_version_id', 'v.config_public'])
        .where('p.id', '=', providerId).executeTakeFirst();
      if (!provider || provider.lifecycle_status !== 'ACTIVE' ||
        typeof provider.config_public.issuer !== 'string') return 'UNKNOWN';
      let succeeded = false;
      try {
        await checkOidcDiscovery(provider.config_public.issuer);
        succeeded = true;
      } catch { /* Record a fixed technical code, never a URL, token or credential. */ }

      const previous = await trx.selectFrom('auth_identity_provider_health')
        .select(['health_status', 'consecutive_failures', 'consecutive_successes'])
        .where('provider_id', '=', providerId).executeTakeFirst();
      const failures = succeeded ? 0 : (previous?.consecutive_failures ?? 0) + 1;
      const successes = succeeded ? (previous?.consecutive_successes ?? 0) + 1 : 0;
      const status = classifyHealth(failures, successes, previous?.health_status ?? 'UNKNOWN');
      const now = new Date();
      await trx.insertInto('auth_identity_provider_health').values({
        provider_id: providerId, active_version_id: provider.active_version_id,
        health_status: status, checked_at: now,
        last_success_at: succeeded ? now : null, last_failure_at: succeeded ? null : now,
        consecutive_failures: failures, consecutive_successes: successes,
        failure_code: succeeded ? null : 'discovery_unavailable',
      }).onConflict((oc) => oc.column('provider_id').doUpdateSet({
        active_version_id: provider.active_version_id, health_status: status,
        checked_at: now,
        ...(succeeded ? { last_success_at: now } : { last_failure_at: now }),
        consecutive_failures: failures, consecutive_successes: successes,
        failure_code: succeeded ? null : 'discovery_unavailable',
      })).execute();
      await trx.insertInto('auth_identity_provider_health_events').values({
        provider_id: providerId, version_id: provider.active_version_id,
        category: succeeded ? 'probe_success' : 'probe_failure',
        failure_code: succeeded ? null : 'discovery_unavailable',
      }).execute();
      return status;
    });
  }

  async recordTechnicalLoginFailure(providerId: string, versionId: string, code: string): Promise<void> {
    // User cancellation / consent denial is not an infrastructure failure.
    if (!['discovery', 'jwks', 'token_endpoint', 'timeout', 'network'].includes(code)) return;
    await this.db.insertInto('auth_identity_provider_health_events').values({
      provider_id: providerId, version_id: versionId,
      category: 'login_technical_failure', failure_code: code,
    }).execute();
  }

  async getHistory(providerId: string, limit = 50) {
    const max = Math.max(1, Math.min(100, Math.floor(limit)));
    const [health, events] = await Promise.all([
      this.db.selectFrom('auth_identity_provider_health').selectAll()
        .where('provider_id', '=', providerId).executeTakeFirst(),
      this.db.selectFrom('auth_identity_provider_health_events')
        .select(['id', 'version_id', 'category', 'failure_code', 'at'])
        .where('provider_id', '=', providerId).orderBy('at', 'desc').limit(max).execute(),
    ]);
    return { health: health ?? null, events };
  }
}
