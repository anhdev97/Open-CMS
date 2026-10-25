import { Inject, Injectable } from '@nestjs/common';
import type { Kysely, Transaction } from 'kysely';
import { OAUTH2_DB } from '../constants';
import type { AuthTables } from '../db/types';

export type AuditType =
  | 'login_succeeded' | 'login_failed' | 'logout' | 'setup_completed' | 'admin_seeded_from_env'
  | 'admin_force_reset' | 'user_created' | 'user_disabled' | 'user_enabled' | 'user_deleted'
  | 'password_reset_by_admin' | 'password_changed' | 'idp_linked' | 'user.locale.update'
  | 'group.create' | 'group.update' | 'group.delete' | 'user.groups.update' | 'user.identity.unlink'
  // Review workflow events, recorded by @opencloudcms/core (spec B §5).
  | 'content.submit' | 'content.withdraw' | 'content.reject' | 'content.publish' | 'content.approve';

export interface AuditEvent {
  type: AuditType;
  userId?: string;
  actorId?: string;
  ip?: string;
  userAgent?: string;
  meta?: Record<string, unknown>;
}

const SENSITIVE = ['password', 'token', 'cookie'];

function scrub(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta ?? {})) {
    const lk = k.toLowerCase();
    if (SENSITIVE.some((s) => lk.includes(s))) continue;
    out[k] = v;
  }
  return out;
}

@Injectable()
export class AuditService {
  constructor(@Inject(OAUTH2_DB) private readonly db: Kysely<AuthTables>) {}

  async record(e: AuditEvent, trx?: Transaction<AuthTables>): Promise<void> {
    await (trx ?? this.db)
      .insertInto('auth_audit_events')
      .values({
        type: e.type,
        user_id: e.userId ?? null,
        actor_id: e.actorId ?? null,
        ip: e.ip ?? null,
        user_agent: e.userAgent ?? null,
        meta: JSON.stringify(scrub(e.meta)),
      })
      .execute();
  }
}
