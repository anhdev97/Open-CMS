/** Parses a Cookie request header. The first occurrence of a name wins (most specific path first). */
export function parseCookies(header: string | string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = Array.isArray(header) ? header.join('; ') : header;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name || name in out) continue;
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1);
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

export interface CookieOptions {
  path: string;
  /** Seconds; 0 deletes the cookie. */
  maxAge: number;
  secure: boolean;
}

/** httpOnly + SameSite=Lax always (spec §7). Values are expected to be base64url (no encoding needed). */
export function serializeCookie(name: string, value: string, o: CookieOptions): string {
  const parts = [`${name}=${value}`, `Path=${o.path}`, `Max-Age=${Math.max(0, Math.floor(o.maxAge))}`];
  if (o.maxAge <= 0) parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  parts.push('HttpOnly', 'SameSite=Lax');
  if (o.secure) parts.push('Secure');
  return parts.join('; ');
}

export const isSecureUrl = (publicUrl: string): boolean => publicUrl.startsWith('https://');
