import { describe, expect, it } from 'vitest';
import { ADMIN_SECURITY_HEADERS, adminCsp, createNonce } from '../../src/web/csp';

describe('createNonce', () => {
  it('is 16 random bytes, base64', () => {
    const n = createNonce();
    expect(Buffer.from(n, 'base64')).toHaveLength(16);
    expect(createNonce()).not.toBe(n);
  });
});

describe('adminCsp', () => {
  it('prod policy is exact and has no dev relaxations', () => {
    const csp = adminCsp('abc', false);
    expect(csp).toBe(
      "default-src 'self'; script-src 'self' 'nonce-abc' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; frame-ancestors 'none'",
    );
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain('ws:');
  });
  it('dev policy allows eval and websockets', () => {
    const csp = adminCsp('abc', true);
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic' 'unsafe-eval'");
    expect(csp.endsWith("; connect-src 'self' ws: wss:")).toBe(true);
  });
});

describe('ADMIN_SECURITY_HEADERS', () => {
  it('has exactly the four headers', () => {
    expect(ADMIN_SECURITY_HEADERS).toEqual({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
      'X-Robots-Tag': 'noindex',
    });
  });
});
