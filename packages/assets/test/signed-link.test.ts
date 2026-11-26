import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ASSET_LINK_TTL_MS, deriveAssetLinkKey, signAssetLink, verifyAssetLink } from '../src/nest/signed-link';

const ID = '7d1b6c1e-0f43-4c39-9d0e-2b9a3f3b8f11';
const OTHER = '0a4c5d64-73b2-4d55-8b3c-8bb4b0f7f0a2';
const USER = '5f0e9e1e-6c0e-4d6b-9c0a-1b2c3d4e5f60';

describe('signed asset links', () => {
  const key = deriveAssetLinkKey(randomBytes(32));

  it('derives a 32-byte key per secret, deterministically', () => {
    const s = randomBytes(32);
    expect(deriveAssetLinkKey(s)).toHaveLength(32);
    expect(deriveAssetLinkKey(s).equals(deriveAssetLinkKey(s))).toBe(true);
    expect(deriveAssetLinkKey(s).equals(deriveAssetLinkKey(randomBytes(32)))).toBe(false);
  });

  it('round-trips and expires after 5 minutes', () => {
    const now = 1_800_000_000_000;
    const { token, expiresAt } = signAssetLink(key, ID, USER, now);
    expect(ASSET_LINK_TTL_MS).toBe(5 * 60_000);
    expect(expiresAt.getTime()).toBe(now + ASSET_LINK_TTL_MS);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(token, 'base64url').toString().split('.').slice(0, 3)).toEqual([ID, String((now + ASSET_LINK_TTL_MS) / 1000), USER]);
    expect(verifyAssetLink(key, token, ID, now)).toEqual({ userId: USER });
    expect(verifyAssetLink(key, token, ID, now + ASSET_LINK_TTL_MS - 1)).toEqual({ userId: USER });
    expect(verifyAssetLink(key, token, ID, now + ASSET_LINK_TTL_MS + 1000)).toBeNull();
  });

  it('rejects tampered tokens, other assets, other keys and garbage', () => {
    const now = Date.now();
    const { token } = signAssetLink(key, ID, USER, now);
    const raw = Buffer.from(token, 'base64url').toString();
    const [id, exp, user, mac] = raw.split('.');
    const enc = (s: string) => Buffer.from(s).toString('base64url');
    expect(verifyAssetLink(key, enc([id, String(Number(exp) + 3600), user, mac].join('.')), ID, now)).toBeNull();
    expect(verifyAssetLink(key, enc([id, exp, OTHER, mac].join('.')), ID, now)).toBeNull();
    expect(verifyAssetLink(key, enc([id, exp, user, mac!.replace(/.$/, (c) => (c === '0' ? '1' : '0'))].join('.')), ID, now)).toBeNull();
    expect(verifyAssetLink(key, token, OTHER, now)).toBeNull();
    expect(verifyAssetLink(deriveAssetLinkKey(randomBytes(32)), token, ID, now)).toBeNull();
    for (const bad of ['', 'x', enc('a.b.c'), enc('a.b.c.d.e'), enc(`${ID}.nope.${USER}.00`)]) {
      expect(verifyAssetLink(key, bad, ID, now)).toBeNull();
    }
  });
});
