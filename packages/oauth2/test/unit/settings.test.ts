import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/schema';
import { ConfigAuthSettingsProvider } from '../../src/settings/settings.provider';
import { AuthError, AuthExceptionFilter } from '../../src/errors';

const env = { OPENCMS_SECRET: Buffer.alloc(32, 7).toString('base64'), OPENCMS_PUBLIC_URL: 'https://cms.x.com' };

describe('ConfigAuthSettingsProvider', () => {
  it('returns default ttls', async () => {
    const warns: string[] = [];
    const p = new ConfigAuthSettingsProvider(loadConfig(env), { warn: (m) => warns.push(m) });
    expect(await p.getTtls()).toEqual({
      accessToken: 900, refreshToken: 30 * 86400, sessionIdle: 7 * 86400,
      sessionAbsolute: 30 * 86400, authorizationCode: 60, interaction: 600,
    });
    expect(warns).toHaveLength(0);
  });
  it('clamps refresh to session absolute and warns once', async () => {
    const warns: string[] = [];
    const cfg = loadConfig({
      ...env, OPENCMS_AUTH_TTL_REFRESH: String(40 * 86400), OPENCMS_AUTH_TTL_SESSION_ABSOLUTE: String(30 * 86400),
    });
    const p = new ConfigAuthSettingsProvider(cfg, { warn: (m) => warns.push(m) });
    expect((await p.getTtls()).refreshToken).toBe(30 * 86400);
    await p.getTtls();
    expect(warns).toHaveLength(1);
  });
});

describe('AuthExceptionFilter', () => {
  function run(err: unknown) {
    const out: any = { headers: {} };
    const res = {
      status(s: number) { out.status = s; return this; },
      json(b: unknown) { out.body = b; return this; },
      setHeader(k: string, v: string) { out.headers[k] = v; return this; },
    };
    const host: any = { switchToHttp: () => ({ getResponse: () => res }) };
    new AuthExceptionFilter().catch(err as AuthError, host);
    return out;
  }
  it('maps AuthError to json', () => {
    const o = run(new AuthError('forbidden', 403, 'nope'));
    expect(o.status).toBe(403);
    expect(o.body).toEqual({ error: { code: 'forbidden', message: 'nope' } });
  });
  it('adds Retry-After', () => {
    const e = new AuthError('rate_limited', 429, 'slow down');
    e.retryAfterSec = 42;
    expect(run(e).headers['Retry-After']).toBe('42');
  });
});
