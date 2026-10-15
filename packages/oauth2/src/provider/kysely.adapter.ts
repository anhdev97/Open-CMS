import type { Kysely } from 'kysely';
import type { AuthTables } from '../db/types';

/**
 * Local copy of the oidc-provider v9 adapter contract (the package ships no type declarations
 * and is ESM-only, so we avoid any import from it).
 */
export interface AdapterPayload {
  grantId?: string;
  uid?: string;
  userCode?: string;
  consumed?: number;
  [key: string]: unknown;
}

export interface Adapter {
  upsert(id: string, payload: AdapterPayload, expiresIn?: number): Promise<void>;
  find(id: string): Promise<AdapterPayload | undefined>;
  findByUserCode(userCode: string): Promise<AdapterPayload | undefined>;
  findByUid(uid: string): Promise<AdapterPayload | undefined>;
  consume(id: string): Promise<void>;
  destroy(id: string): Promise<void>;
  revokeByGrantId(grantId: string): Promise<void>;
}

export type AdapterConstructor = new (name: string) => Adapter;

export interface KyselyAdapterOptions {
  now?: () => Date;
}

type Row = { payload: unknown; expires_at: Date | null; consumed_at: Date | null };

export function createKyselyAdapter(db: Kysely<AuthTables>, opts: KyselyAdapterOptions = {}): AdapterConstructor {
  const now = opts.now ?? (() => new Date());

  return class KyselyAdapter implements Adapter {
    constructor(private readonly name: string) {}

    async upsert(id: string, payload: AdapterPayload, expiresIn?: number): Promise<void> {
      const expiresAt = expiresIn ? new Date(now().getTime() + expiresIn * 1000) : null;
      const row = {
        payload: JSON.stringify(payload),
        grant_id: payload.grantId ?? null,
        uid: payload.uid ?? null,
        user_code: payload.userCode ?? null,
        expires_at: expiresAt,
      };
      await db
        .insertInto('auth_oidc_payloads')
        .values({ kind: this.name, id, ...row })
        .onConflict((oc) => oc.columns(['kind', 'id']).doUpdateSet(row))
        .execute();
    }

    async find(id: string): Promise<AdapterPayload | undefined> {
      const row = await db
        .selectFrom('auth_oidc_payloads')
        .select(['payload', 'expires_at', 'consumed_at'])
        .where('kind', '=', this.name)
        .where('id', '=', id)
        .executeTakeFirst();
      return this.toPayload(row);
    }

    async findByUid(uid: string): Promise<AdapterPayload | undefined> {
      const row = await db
        .selectFrom('auth_oidc_payloads')
        .select(['payload', 'expires_at', 'consumed_at'])
        .where('kind', '=', this.name)
        .where('uid', '=', uid)
        .executeTakeFirst();
      return this.toPayload(row);
    }

    async findByUserCode(userCode: string): Promise<AdapterPayload | undefined> {
      const row = await db
        .selectFrom('auth_oidc_payloads')
        .select(['payload', 'expires_at', 'consumed_at'])
        .where('kind', '=', this.name)
        .where('user_code', '=', userCode)
        .executeTakeFirst();
      return this.toPayload(row);
    }

    async consume(id: string): Promise<void> {
      await db
        .updateTable('auth_oidc_payloads')
        .set({ consumed_at: now() })
        .where('kind', '=', this.name)
        .where('id', '=', id)
        .execute();
    }

    async destroy(id: string): Promise<void> {
      await db.deleteFrom('auth_oidc_payloads').where('kind', '=', this.name).where('id', '=', id).execute();
    }

    async revokeByGrantId(grantId: string): Promise<void> {
      await db.deleteFrom('auth_oidc_payloads').where('grant_id', '=', grantId).execute();
    }

    private toPayload(row: Row | undefined): AdapterPayload | undefined {
      if (!row) return undefined;
      if (row.expires_at && row.expires_at.getTime() <= now().getTime()) return undefined;
      const payload = (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) as AdapterPayload;
      if (row.consumed_at) return { ...payload, consumed: Math.floor(row.consumed_at.getTime() / 1000) };
      return payload;
    }
  };
}
