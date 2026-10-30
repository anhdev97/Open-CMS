import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { assertPublicHttpsUrl, validateOidcDiscovery, type OidcDiscoveryDocument } from './provider-validation.service';

function publicIp(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31
      || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127
      || a === 192 && b === 0 || a === 198 && (b === 18 || b === 19)
      || a === 198 && b === 51 && c === 100 || a === 203 && b === 0 && c === 113);
  }
  if (isIP(address) === 6) {
    const ip = address.toLowerCase();
    // Only allow global unicast 2000::/3; reject documentation 2001:db8::/32.
    return /^[23][0-9a-f]*:/.test(ip) && !ip.startsWith('2001:db8:');
  }
  return false;
}

/**
 * Strict HTTPS fetch: DNS resolved once, validated, then pinned into TLS
 * connection via custom lookup. TLS hostname verification remains enabled.
 * Redirects are never followed; responses and time are bounded.
 */
export async function fetchOidcJson(rawUrl: string): Promise<unknown> {
  const url = assertPublicHttpsUrl(rawUrl);
  const records = await lookup(url.hostname, { all: true });
  if (!records.length || records.some((r) => !publicIp(r.address))) {
    throw new Error('OIDC endpoint DNS returned a non-public address');
  }
  const pinned = records[0];
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: 'GET',
      timeout: 5000,
      maxHeaderSize: 8192,
      headers: { accept: 'application/json' },
      lookup: (_host, _opts, callback) => callback(null, pinned.address, pinned.family),
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error('OIDC endpoint returned non-200 response (redirects disallowed)'));
        return;
      }
      const contentType = String(res.headers['content-type'] ?? '');
      if (!/^application\/(json|[\w.+-]+\+json)(?:;|$)/i.test(contentType)) {
        res.resume();
        reject(new Error('OIDC endpoint must return JSON'));
        return;
      }
      let length = 0;
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => {
        length += chunk.length;
        if (length > 128 * 1024) {
          req.destroy(new Error('OIDC metadata exceeds size limit'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new Error('Invalid OIDC JSON')); }
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('OIDC metadata request timed out')));
    req.on('error', reject);
    req.end();
  });
}

/** Network-only metadata validation; does NOT verify client credentials. */
export async function checkOidcDiscovery(issuer: string): Promise<OidcDiscoveryDocument> {
  const url = assertPublicHttpsUrl(issuer);
  const base = url.pathname.replace(/\/$/, '');
  // RFC 8414 path insertion differs from OpenID Connect Discovery. Use OIDC Discovery.
  const discoveryUrl = new URL(url.toString());
  discoveryUrl.pathname = base + '/.well-known/openid-configuration';
  const metadata = validateOidcDiscovery(issuer, await fetchOidcJson(discoveryUrl.toString()));
  const jwks = await fetchOidcJson(metadata.jwks_uri);
  if (!jwks || typeof jwks !== 'object' || !Array.isArray((jwks as { keys?: unknown }).keys)
    || !(jwks as { keys: unknown[] }).keys.length) {
    throw new Error('OIDC JWKS must contain public keys');
  }
  return metadata;
}

/**
 * Transport for openid-client/OAuth token calls, with the same DNS-pinning
 * guarantee as discovery. Redirects are returned as-is (never followed here).
 * On all future IdP interactions use this transport, not the global fetch.
 */
export async function secureOidcFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const outbound = new Request(input, { ...init, redirect: 'manual' });
  const url = assertPublicHttpsUrl(outbound.url);
  const records = await lookup(url.hostname, { all: true });
  if (!records.length || records.some((record) => !publicIp(record.address))) {
    throw new Error('OIDC DNS resolved to non-public address');
  }
  const pinned = records[0];
  const data = outbound.body ? Buffer.from(await outbound.arrayBuffer()) : undefined;
  if (data && data.byteLength > 128 * 1024) throw new Error('OIDC request body exceeds size limit');
  return new Promise<Response>((resolve, reject) => {
    const headers: Record<string, string> = {};
    outbound.headers.forEach((value, key) => { headers[key] = value; });
    const req = request(url, {
      method: outbound.method,
      headers,
      timeout: 8000,
      maxHeaderSize: 8192,
      lookup: (_host, _opts, callback) => callback(null, pinned.address, pinned.family),
    }, (res) => {
      let length = 0;
      const chunks: Buffer[] = [];
      res.on('data', (part: Buffer) => {
        length += part.length;
        if (length > 1024 * 1024) {
          req.destroy(new Error('OIDC response exceeds size limit'));
          return;
        }
        chunks.push(part);
      });
      res.on('end', () => {
        const h = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (Array.isArray(value)) value.forEach((entry) => h.append(key, entry));
          else if (value !== undefined) h.set(key, String(value));
        }
        resolve(new Response(Buffer.concat(chunks), {
          status: res.statusCode ?? 502,
          statusText: res.statusMessage,
          headers: h,
        }));
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('OIDC request timed out')));
    req.on('error', reject);
    if (outbound.signal.aborted) { req.destroy(new Error('OIDC request aborted')); return; }
    const abort = () => req.destroy(new Error('OIDC request aborted'));
    outbound.signal.addEventListener('abort', abort, { once: true });
    req.once('close', () => outbound.signal.removeEventListener('abort', abort));
    req.end(data);
  });
}
