import { generateKeyPairSync, randomBytes } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { AuthTables } from '../db/types';
import { open, seal } from '../security/crypto';

/** Private EC JWK as stored (sealed) in auth_signing_keys and handed to oidc-provider's `jwks`. */
export type JWK = {
  kty: string;
  crv?: string;
  x?: string;
  y?: string;
  d?: string;
  kid: string;
  alg: string;
  use?: string;
  [k: string]: unknown;
};

function generateEs256(): JWK {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = privateKey.export({ format: 'jwk' }) as Record<string, string>;
  return { ...jwk, kty: jwk.kty, kid: randomBytes(16).toString('base64url'), alg: 'ES256', use: 'sig' };
}

/**
 * Spec §6.1 step 2. Returns all non-retired private JWKs (decrypted with `key`); generates, seals and
 * stores one ES256 key when none is active.
 */
export async function ensureSigningKey(db: Kysely<AuthTables>, key: Buffer): Promise<JWK[]> {
  const load = async () =>
    db
      .selectFrom('auth_signing_keys')
      .select(['kid', 'jwk_private_enc'])
      .where('retired_at', 'is', null)
      .orderBy('created_at', 'desc')
      .execute();

  let rows = await load();
  if (rows.length === 0) {
    const jwk = generateEs256();
    await db
      .insertInto('auth_signing_keys')
      .values({ kid: jwk.kid, jwk_private_enc: seal(key, JSON.stringify(jwk)), alg: 'ES256', created_at: new Date() })
      .execute();
    rows = await load();
  }
  return rows.map((r) => JSON.parse(open(key, r.jwk_private_enc)) as JWK);
}
