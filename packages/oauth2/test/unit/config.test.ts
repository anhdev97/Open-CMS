import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config/schema';

const secret = Buffer.alloc(32, 7).toString('base64');
const base = { OPENCLOUDCMS_SECRET: secret, OPENCLOUDCMS_PUBLIC_URL: 'https://cms.x.com' };

describe('loadConfig', () => {
  it('throws when OPENCLOUDCMS_SECRET is missing', () => {
    expect(() => loadConfig({})).toThrow(/OPENCLOUDCMS_SECRET/);
  });
  it('rejects a 31 byte secret', () => {
    const env = { ...base, OPENCLOUDCMS_SECRET: Buffer.alloc(31, 1).toString('base64') };
    expect(() => loadConfig(env)).toThrow(/OPENCLOUDCMS_SECRET/);
  });
  it('accepts hex secrets', () => {
    const cfg = loadConfig({ ...base, OPENCLOUDCMS_SECRET: 'ab'.repeat(32) });
    expect(cfg.secret.length).toBe(32);
  });
  it('defaults publicUrl and internalUrl from PORT (4000 when unset) outside production', () => {
    const cfg = loadConfig({ OPENCLOUDCMS_SECRET: secret });
    expect(cfg.publicUrl).toBe('http://localhost:4000');
    expect(cfg.internalUrl).toBe('http://127.0.0.1:4000');
    const c5 = loadConfig({ OPENCLOUDCMS_SECRET: secret, PORT: '5000' });
    expect(c5.publicUrl).toBe('http://localhost:5000');
    expect(c5.internalUrl).toBe('http://127.0.0.1:5000');
  });
  it('requires OPENCLOUDCMS_PUBLIC_URL when NODE_ENV=production', () => {
    const run = () => loadConfig({ OPENCLOUDCMS_SECRET: secret, NODE_ENV: 'production' });
    expect(run).toThrow(ConfigError);
    expect(run).toThrow(/OPENCLOUDCMS_PUBLIC_URL/);
  });
  it('ignores OPENCLOUDCMS_INTERNAL_URL', () => {
    const cfg = loadConfig({ ...base, OPENCLOUDCMS_INTERNAL_URL: 'http://app:8080' });
    expect(cfg.internalUrl).toBe('http://127.0.0.1:4000');
  });
  it('strips trailing slash from publicUrl', () => {
    const cfg = loadConfig({ ...base, OPENCLOUDCMS_PUBLIC_URL: 'https://cms.x.com/' });
    expect(cfg.publicUrl).toBe('https://cms.x.com');
  });
  it('env ttl overrides file config', () => {
    const cfg = loadConfig({ ...base, OPENCLOUDCMS_AUTH_TTL_ACCESS: '60' }, { ttl: { accessToken: 120 } });
    expect(cfg.ttl.accessToken).toBe(60);
  });
  it('file config applies when env is absent', () => {
    expect(loadConfig(base, { ttl: { accessToken: 120 } }).ttl.accessToken).toBe(120);
  });
  it('has documented defaults', () => {
    const cfg = loadConfig(base);
    expect(cfg.ttl).toEqual({
      accessToken: 900, refreshToken: 30 * 86400, sessionIdle: 7 * 86400,
      sessionAbsolute: 30 * 86400, authorizationCode: 60, interaction: 600,
    });
    expect(cfg.password.minLength).toBe(12);
    expect(cfg.rateLimit).toEqual({
      loginPerEmail: { limit: 5, windowSec: 900 }, loginPerIp: { limit: 20, windowSec: 900 },
    });
    expect(cfg.idp.oidc).toBeUndefined();
    expect(cfg.admin.forceReset).toBe(false);
  });
  it('reads oidc idp and admin env', () => {
    const cfg = loadConfig({
      ...base,
      OPENCLOUDCMS_IDP_OIDC_ISSUER: 'https://idp.example', OPENCLOUDCMS_IDP_OIDC_CLIENT_ID: 'id',
      OPENCLOUDCMS_IDP_OIDC_CLIENT_SECRET: 's', OPENCLOUDCMS_ADMIN_EMAIL: 'a@b.c',
      OPENCLOUDCMS_ADMIN_PASSWORD: 'pw', OPENCLOUDCMS_ADMIN_FORCE_RESET: 'true',
    });
    expect(cfg.idp.oidc).toEqual({ issuer: 'https://idp.example', clientId: 'id', clientSecret: 's', label: 'SSO' });
    expect(cfg.admin).toMatchObject({ email: 'a@b.c', password: 'pw', forceReset: true });
  });
  it('rejects non numeric ttl', () => {
    expect(() => loadConfig({ ...base, OPENCLOUDCMS_AUTH_TTL_ACCESS: 'abc' })).toThrow(/ttl/i);
  });
});
