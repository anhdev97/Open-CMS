import type { TestApp } from './app';
import { CookieJar } from './interaction';

export interface RecordedResponse {
  method: string;
  url: string;
  status: number;
  headers: Record<string, string>;
  setCookies: string[];
  body: string;
}

export interface LoginResult {
  /** Value of the `oc_session` cookie set by the callback (undefined if none was set). */
  sessionCookie?: string;
  /** Location of the callback's 302. */
  finalLocation: string;
  /** Set-Cookie lines of the callback response. */
  callbackSetCookies: string[];
  /** Every response of the chain, with its body read as text. */
  responses: RecordedResponse[];
  cookies: CookieJar;
}

export interface LoginOptions {
  returnTo?: string;
  loginHint?: string;
  /** Lets a test tamper with the callback URL (public form) before the browser follows it. */
  beforeCallback?: (url: URL) => void;
}

/**
 * Drives the real browser chain like a browser behind the app's public origin:
 * GET /api/auth/login → /oauth2/auth → /admin/login?uid → POST interaction login → provider resume
 * redirects → GET /api/auth/callback. Requests are physically sent to `t.baseUrl`; when the public URL
 * differs (TLS reverse proxy, or dev `localhost` vs the 127.0.0.1 listener), `Host` and `X-Forwarded-Proto`/`X-Forwarded-Host`
 * of the public URL are added the way the browser / proxy would.
 */
export async function loginAs(t: TestApp, email: string, password: string, opts: LoginOptions = {}): Promise<LoginResult> {
  const pub = new URL(t.url);
  const physical = new URL(t.baseUrl);
  const proxied = pub.origin !== physical.origin;
  const forwarded: Record<string, string> = proxied
    ? { host: pub.host, 'x-forwarded-proto': pub.protocol.replace(':', ''), 'x-forwarded-host': pub.host }
    : {};
  const cookies = new CookieJar();
  const responses: RecordedResponse[] = [];

  const toPhysical = (href: string): string => {
    const u = new URL(href, t.url);
    if (u.origin !== pub.origin) throw new Error(`browser left the app origin: ${u.href}`);
    return new URL(u.pathname + u.search, physical.origin).toString();
  };
  const send = async (publicHref: string, init: RequestInit = {}) => {
    const target = toPhysical(publicHref);
    const headers = { 'user-agent': 'vitest-bff', ...forwarded, ...(init.headers as Record<string, string>) };
    const res = await cookies.fetch(target, { ...init, headers });
    const body = await res.text();
    const h: Record<string, string> = {};
    res.headers.forEach((v, k) => (h[k] = v));
    const setCookies = res.headers.getSetCookie();
    responses.push({ method: init.method ?? 'GET', url: target, status: res.status, headers: h, setCookies, body });
    return { res, body, location: res.headers.get('location') ?? undefined, setCookies };
  };
  const expectRedirect = (r: { res: Response; body: string; location?: string }, what: string): string => {
    if (r.res.status < 300 || r.res.status >= 400 || !r.location) {
      throw new Error(`expected a redirect from ${what}, got ${r.res.status}: ${r.body}`);
    }
    return new URL(r.location, t.url).toString();
  };

  const q = new URLSearchParams();
  if (opts.returnTo !== undefined) q.set('returnTo', opts.returnTo);
  if (opts.loginHint !== undefined) q.set('login_hint', opts.loginHint);
  let next = expectRedirect(await send(`${t.url}/api/auth/login${q.size ? `?${q}` : ''}`), '/api/auth/login');
  if (!next.startsWith(`${t.url}/oauth2/auth?`)) throw new Error(`login did not go to the provider: ${next}`);

  const toInteraction = new URL(expectRedirect(await send(next), '/oauth2/auth'));
  const uid = toInteraction.searchParams.get('uid');
  if (toInteraction.pathname !== '/admin/login' || !uid) throw new Error(`unexpected interaction redirect ${toInteraction}`);

  const login = await send(`${t.url}/oauth2/interaction/${uid}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: pub.origin },
    body: JSON.stringify({ email, password }),
  });
  if (login.res.status !== 200) throw new Error(`interaction login failed ${login.res.status}: ${login.body}`);
  next = new URL((JSON.parse(login.body) as { redirectTo: string }).redirectTo, t.url).toString();

  const callbackPrefix = `${t.url}/api/auth/callback`;
  for (let hop = 0; !next.startsWith(callbackPrefix); hop++) {
    if (hop >= 10) throw new Error('too many redirects');
    if (!next.startsWith(`${t.url}/oauth2/`)) throw new Error(`redirected outside the provider: ${next}`);
    next = expectRedirect(await send(next), next);
  }

  const callbackUrl = new URL(next);
  opts.beforeCallback?.(callbackUrl);
  const cb = await send(callbackUrl.toString());
  const finalLocation = cb.location ?? '';
  const sessionLine = cb.setCookies.find((c) => c.startsWith('oc_session='));
  const sessionCookie = sessionLine ? sessionLine.split(';')[0].slice('oc_session='.length) || undefined : undefined;
  return { sessionCookie, finalLocation, callbackSetCookies: cb.setCookies, responses, cookies };
}

/**
 * A browser that already went through a login (same jar, incl. the provider's `_session` cookie) starts
 * `GET /api/auth/login` again. Follows same-origin redirects until the chain leaves the provider and
 * returns where it ended plus whether the callback set a new `oc_session` (a silent re-login).
 */
export async function restartLogin(t: TestApp, cookies: CookieJar): Promise<{ location: URL; newSession: boolean }> {
  let next = `${t.url}/api/auth/login`;
  let newSession = false;
  for (let hop = 0; hop < 12; hop++) {
    const res = await cookies.fetch(next, { headers: { 'user-agent': 'vitest-bff' } });
    if (res.headers.getSetCookie().some((l) => /^oc_session=[^;]+/.test(l))) newSession = true;
    const loc = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !loc) throw new Error(`no redirect from ${next}: ${res.status}`);
    const u = new URL(loc, next);
    const inChain = u.origin === new URL(t.url).origin && (u.pathname.startsWith('/oauth2/') || u.pathname === '/api/auth/callback');
    if (!inChain) return { location: u, newSession };
    next = u.toString();
  }
  throw new Error('too many redirects');
}
