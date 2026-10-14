import { createHash, randomBytes } from 'node:crypto';

type Cookie = { name: string; value: string; path: string };

/**
 * Minimal path-aware cookie jar (single host). It honours `Path` like a browser does, so a cookie the
 * provider scopes to e.g. `/oauth2/auth/<uid>` is not sent to `/oauth2/interaction/<uid>`.
 */
export class CookieJar {
  private readonly cookies = new Map<string, Cookie>();

  store(res: Response, requestUrl: string): void {
    const reqPath = new URL(requestUrl).pathname;
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';').map((p) => p.trim());
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      let path = reqPath.slice(0, reqPath.lastIndexOf('/')) || '/';
      let expired = value === '';
      for (const a of attrs) {
        const [k, v = ''] = a.split('=');
        const key = k.toLowerCase();
        if (key === 'path') path = v || '/';
        if (key === 'max-age' && Number(v) <= 0) expired = true;
        if (key === 'expires' && new Date(v).getTime() < Date.now()) expired = true;
      }
      const id = `${name}\u0000${path}`;
      if (expired) this.cookies.delete(id);
      else this.cookies.set(id, { name, value, path });
    }
  }

  header(url: string): string {
    const p = new URL(url).pathname;
    return [...this.cookies.values()]
      .filter((c) => p === c.path || p.startsWith(c.path.endsWith('/') ? c.path : `${c.path}/`))
      .sort((a, b) => b.path.length - a.path.length)
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
  }

  /** fetch with the jar's cookies, `redirect: 'manual'`, storing any Set-Cookie of the response. */
  async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    const cookie = this.header(url);
    if (cookie) headers.set('cookie', cookie);
    const res = await fetch(url, { ...init, headers, redirect: 'manual' });
    this.store(res, url);
    return res;
  }
}

export interface StartedInteraction {
  uid: string;
  cookies: CookieJar;
  verifier: string;
  state: string;
  nonce: string;
}

const b64url = (b: Buffer) => b.toString('base64url');

/** Starts an authorization request for opencms-admin (PKCE S256) and returns the interaction uid. */
export async function startInteraction(url: string, opts: { loginHint?: string } = {}): Promise<StartedInteraction> {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(16));
  const nonce = b64url(randomBytes(16));
  const q = new URLSearchParams({
    client_id: 'opencms-admin',
    response_type: 'code',
    scope: 'openid profile email offline_access',
    redirect_uri: `${url}/api/auth/callback`,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  });
  if (opts.loginHint) q.set('login_hint', opts.loginHint);
  const cookies = new CookieJar();
  const res = await cookies.fetch(`${url}/oauth2/auth?${q}`);
  const location = res.headers.get('location');
  if (res.status < 300 || res.status >= 400 || !location) {
    throw new Error(`expected a redirect from /oauth2/auth, got ${res.status}: ${await res.text()}`);
  }
  const loc = new URL(location, url);
  const uid = loc.searchParams.get('uid');
  if (loc.pathname !== '/admin/login' || !uid) throw new Error(`unexpected interaction redirect ${location}`);
  return { uid, cookies, verifier, state, nonce };
}

/**
 * Follows provider redirects from `redirectTo` (manually, with the jar) until the Location points at the
 * BFF callback, then returns its code/state. Throws on any non-redirect or on a redirect elsewhere
 * that does not continue inside the provider.
 */
export async function followToCode(
  url: string,
  redirectTo: string,
  cookies: CookieJar,
): Promise<{ code: string; state: string | null; location: string }> {
  const callback = `${url}/api/auth/callback`;
  let next = new URL(redirectTo, url).toString();
  for (let hop = 0; hop < 10; hop++) {
    if (next.startsWith(callback)) {
      const u = new URL(next);
      const code = u.searchParams.get('code');
      if (!code) throw new Error(`callback without code: ${next}`);
      return { code, state: u.searchParams.get('state'), location: next };
    }
    if (!next.startsWith(`${url}/oauth2/`)) throw new Error(`redirected outside the provider: ${next}`);
    const res = await cookies.fetch(next);
    const location = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !location) {
      throw new Error(`expected a redirect from ${next}, got ${res.status}: ${await res.text()}`);
    }
    next = new URL(location, next).toString();
  }
  throw new Error('too many redirects');
}
