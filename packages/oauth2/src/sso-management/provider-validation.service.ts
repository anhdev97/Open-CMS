import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

/**
 * Reject obvious SSRF destinations before any discovery call.
 * DNS answers must ALSO be validated on every connection, and redirects disabled.
 */
export function assertPublicHttpsUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('Invalid OIDC URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443') {
    throw new Error('OIDC endpoint must use HTTPS on port 443 without credentials');
  }
  if (url.hash) throw new Error('OIDC endpoint must not contain a fragment');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost')
    || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.test')
    || host.endsWith('.invalid') || host.endsWith('.example')) {
    throw new Error('OIDC endpoint host is not publicly routable');
  }
  // Hostnames that parse as IP literals must be checked against all special ranges.
  if (host.startsWith('[') || isIP(host)) {
    throw new Error('IP literal OIDC endpoints are not allowed');
  }
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host)) {
    throw new Error('Invalid OIDC hostname');
  }
  return url;
}

export interface OidcDiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  response_types_supported: string[];
  code_challenge_methods_supported?: string[];
}

/** Validates discovery metadata, but does not make any outbound network calls. */
export function validateOidcDiscovery(
  expectedIssuer: string,
  metadata: unknown,
): OidcDiscoveryDocument {
  const issuer = assertPublicHttpsUrl(expectedIssuer).toString().replace(/\/$/, '');
  if (!metadata || typeof metadata !== 'object') throw new Error('Invalid OIDC discovery metadata');
  const m = metadata as Record<string, unknown>;
  if (typeof m.issuer !== 'string' || m.issuer !== issuer) {
    throw new Error('OIDC issuer mismatch');
  }
  for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) {
    if (typeof m[key] !== 'string') throw new Error('Missing OIDC endpoint');
    assertPublicHttpsUrl(m[key]);
  }
  if (!Array.isArray(m.response_types_supported) || !m.response_types_supported.includes('code')) {
    throw new Error('OIDC authorization code flow is not supported');
  }
  if (!Array.isArray(m.code_challenge_methods_supported)
    || !m.code_challenge_methods_supported.includes('S256')) {
    throw new Error('OIDC PKCE S256 is required');
  }
  return m as unknown as OidcDiscoveryDocument;
}

/**
 * DNS preflight only. Callers MUST pin validated IPs to the actual TLS socket
 * (or use an outbound proxy enforcing public IP ranges) to prevent DNS rebinding.
 * Never use this helper alone to authorize a fetch.
 */
export async function resolvePublicAddresses(url: URL): Promise<string[]> {
  assertPublicHttpsUrl(url.toString());
  const records = await lookup(url.hostname, { all: true, verbatim: true });
  if (records.length === 0) throw new Error('OIDC host did not resolve');
  for (const record of records) {
    const ip = record.address.toLowerCase();
    if (record.family === 4) {
      const octets = ip.split('.').map(Number);
      const [a, b, d] = octets;
      if (a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254
        || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168
        || a === 100 && b >= 64 && b <= 127 || a === 192 && b === 0
        || a === 198 && (b === 18 || b === 19)
        || a === 192 && b === 0 && d === 0) {
        throw new Error('OIDC hostname resolved to a non-public address');
      }
    } else if (record.family === 6) {
      if (ip === '::1' || ip === '::' || ip.startsWith('fc') || ip.startsWith('fd')
        || /^fe[89ab]/.test(ip) || ip.startsWith('ff')
        || ip.startsWith('2001:db8:') || ip.startsWith('::ffff:')) {
        throw new Error('OIDC hostname resolved to a non-public address');
      }
    } else throw new Error('Unsupported DNS address family');
  }
  return records.map((record) => record.address);
}
