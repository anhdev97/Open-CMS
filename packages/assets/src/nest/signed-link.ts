/**
 * Short-lived signed download links for private assets (decision 15). Token = base64url(`<assetId>.<exp>.<userId>.<hmac>`)
 * with `exp` in Unix seconds and `hmac` = hex HMAC-SHA256 over `<assetId>|<exp>|<userId>`, keyed by a key derived
 * (HKDF) from the auth secret. Checked without a session.
 */
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

export const ASSET_LINK_TTL_MS = 5 * 60_000;

/** `hkdf(sha256, secret, salt='opencloudcms-asset-link', info='v1', 32)`. */
export function deriveAssetLinkKey(secret: Buffer | string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'opencloudcms-asset-link', 'v1', 32));
}

const mac = (key: Buffer, assetId: string, exp: string, userId: string): string =>
  createHmac('sha256', key).update(`${assetId}|${exp}|${userId}`).digest('hex');

export function signAssetLink(key: Buffer, assetId: string, userId: string, now = Date.now()): { token: string; expiresAt: Date } {
  const expMs = Math.floor((now + ASSET_LINK_TTL_MS) / 1000) * 1000;
  const exp = String(expMs / 1000);
  const token = Buffer.from(`${assetId}.${exp}.${userId}.${mac(key, assetId, exp, userId)}`).toString('base64url');
  return { token, expiresAt: new Date(expMs) };
}

/** The signing user when `token` is a valid, unexpired link for `assetId`; otherwise null. */
export function verifyAssetLink(key: Buffer, token: string, assetId: string, now = Date.now()): { userId: string } | null {
  if (typeof token !== 'string' || !token || token.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const parts = Buffer.from(token, 'base64url').toString('utf8').split('.');
  if (parts.length !== 4) return null;
  const [id, exp, userId, sig] = parts as [string, string, string, string];
  if (id !== assetId || !/^\d{1,12}$/.test(exp) || !userId || !/^[0-9a-f]{64}$/.test(sig)) return null;
  const expected = Buffer.from(mac(key, id, exp, userId), 'hex');
  if (!timingSafeEqual(expected, Buffer.from(sig, 'hex'))) return null;
  if (Number(exp) * 1000 <= now) return null;
  return { userId };
}
