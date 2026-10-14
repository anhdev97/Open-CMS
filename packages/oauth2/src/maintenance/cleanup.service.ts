import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { OAUTH2_DB } from '../constants';
import type { AuthTables } from '../db/types';

const INTERVAL_MS = 3600 * 1000;

/** Deletes expired provider payloads and BFF sessions: once on boot, then hourly. */
@Injectable()
export class CleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('OAuth2Cleanup');
  private timer?: NodeJS.Timeout;

  constructor(@Inject(OAUTH2_DB) private readonly db: Kysely<AuthTables>) {}

  async run(now = new Date()): Promise<{ payloads: number; sessions: number }> {
    const p = await this.db.deleteFrom('auth_oidc_payloads').where('expires_at', '<', now).executeTakeFirst();
    const s = await this.db
      .deleteFrom('auth_sessions')
      .where((eb) => eb.or([eb('idle_expires_at', '<', now), eb('absolute_expires_at', '<', now)]))
      .executeTakeFirst();
    return { payloads: Number(p.numDeletedRows), sessions: Number(s.numDeletedRows) };
  }

  onModuleInit(): void {
    void this.safeRun();
    this.timer = setInterval(() => void this.safeRun(), INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async safeRun(): Promise<void> {
    try {
      await this.run();
    } catch (e) {
      // Log the error class only: messages can embed query text.
      this.log.error(`cleanup failed: ${e instanceof Error ? e.name : 'UnknownError'}`);
    }
  }
}
