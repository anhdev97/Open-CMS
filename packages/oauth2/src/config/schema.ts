import { z } from 'zod';
import { ConfigError } from '../errors';

export { ConfigError };

export type Ttls = {
  accessToken: number;
  refreshToken: number;
  sessionIdle: number;
  sessionAbsolute: number;
  authorizationCode: number;
  interaction: number;
};

type RateRule = { limit: number; windowSec: number };

export type OAuth2Config = {
  publicUrl: string;
  internalUrl: string;
  secret: Buffer;
  ttl: Ttls;
  password: { minLength: number };
  rateLimit: { loginPerEmail: RateRule; loginPerIp: RateRule };
  idp: { oidc?: { issuer: string; clientId: string; clientSecret: string; label: string } };
  admin: { email?: string; password?: string; name?: string; forceReset: boolean };
};

/** Non-secret part of `auth` in opencms.config.ts. */
export type AuthFileConfig = {
  publicUrl?: string;
  internalUrl?: string;
  ttl?: Partial<Ttls>;
  password?: { minLength?: number };
  rateLimit?: { loginPerEmail?: Partial<RateRule>; loginPerIp?: Partial<RateRule> };
  idp?: { oidc?: { issuer: string; clientId: string; clientSecret: string; label?: string } };
};

const DAY = 86400;
const sec = z.number().int().positive();
const rule = (limit: number) =>
  z.object({ limit: z.number().int().positive().default(limit), windowSec: sec.default(900) }).default({});

const schema = z.object({
  publicUrl: z.string().url(),
  internalUrl: z.string().url(),
  ttl: z.object({
    accessToken: sec.default(900),
    refreshToken: sec.default(30 * DAY),
    sessionIdle: sec.default(7 * DAY),
    sessionAbsolute: sec.default(30 * DAY),
    authorizationCode: sec.default(60),
    interaction: sec.default(600),
  }).default({}),
  password: z.object({ minLength: z.number().int().min(1).max(256).default(12) }).default({}),
  rateLimit: z.object({ loginPerEmail: rule(5), loginPerIp: rule(20) }).default({}),
  idp: z.object({
    oidc: z.object({
      issuer: z.string().min(1), clientId: z.string().min(1),
      clientSecret: z.string().min(1), label: z.string().default('SSO'),
    }).optional(),
  }).default({}),
  admin: z.object({
    email: z.string().optional(), password: z.string().optional(),
    name: z.string().optional(), forceReset: z.boolean().default(false),
  }).default({}),
});

const trimSlash = (s: string) => s.replace(/\/+$/, '');

function decodeSecret(raw: string | undefined): Buffer {
  if (!raw) throw new ConfigError('OPENCMS_SECRET is required (at least 32 bytes, base64 or hex)');
  const v = raw.trim();
  const buf = /^[0-9a-fA-F]+$/.test(v) && v.length % 2 === 0
    ? Buffer.from(v, 'hex')
    : Buffer.from(v, 'base64');
  if (buf.length < 32) {
    throw new ConfigError(`OPENCMS_SECRET must decode to at least 32 bytes (got ${buf.length})`);
  }
  return buf;
}

function envInt(env: NodeJS.ProcessEnv, name: string): number | undefined {
  const v = env[name];
  if (v === undefined || v === '') return undefined;
  if (!/^\d+$/.test(v.trim())) throw new ConfigError(`${name} must be a positive integer (ttl seconds), got "${v}"`);
  return Number(v);
}

export function loadConfig(env: NodeJS.ProcessEnv, file: Partial<AuthFileConfig> = {}): OAuth2Config {
  const secret = decodeSecret(env.OPENCMS_SECRET);
  const publicRaw = env.OPENCMS_PUBLIC_URL || file.publicUrl;
  if (!publicRaw) throw new ConfigError('OPENCMS_PUBLIC_URL is required');
  const publicUrl = trimSlash(publicRaw.trim());
  const internalUrl = trimSlash(
    (env.OPENCMS_INTERNAL_URL || file.internalUrl || `http://127.0.0.1:${env.PORT ?? 3000}`).trim(),
  );

  const ttl = {
    ...file.ttl,
    ...pick({
      accessToken: envInt(env, 'OPENCMS_AUTH_TTL_ACCESS'),
      refreshToken: envInt(env, 'OPENCMS_AUTH_TTL_REFRESH'),
      sessionIdle: envInt(env, 'OPENCMS_AUTH_TTL_SESSION_IDLE'),
      sessionAbsolute: envInt(env, 'OPENCMS_AUTH_TTL_SESSION_ABSOLUTE'),
    }),
  };

  const issuer = env.OPENCMS_IDP_OIDC_ISSUER;
  const oidc = issuer
    ? {
        issuer,
        clientId: env.OPENCMS_IDP_OIDC_CLIENT_ID ?? file.idp?.oidc?.clientId,
        clientSecret: env.OPENCMS_IDP_OIDC_CLIENT_SECRET ?? file.idp?.oidc?.clientSecret,
        label: env.OPENCMS_IDP_OIDC_LABEL ?? file.idp?.oidc?.label,
      }
    : file.idp?.oidc;

  const parsed = schema.safeParse({
    publicUrl,
    internalUrl,
    ttl,
    password: file.password,
    rateLimit: file.rateLimit,
    idp: { oidc },
    admin: {
      email: env.OPENCMS_ADMIN_EMAIL || undefined,
      password: env.OPENCMS_ADMIN_PASSWORD || undefined,
      name: env.OPENCMS_ADMIN_NAME || undefined,
      forceReset: env.OPENCMS_ADMIN_FORCE_RESET === 'true',
    },
  });
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ConfigError(`Invalid auth config: ${detail}`);
  }
  return { ...parsed.data, secret } as OAuth2Config;
}

function pick<T extends Record<string, number | undefined>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
