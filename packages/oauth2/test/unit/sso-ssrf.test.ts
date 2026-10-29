import { describe, expect, it } from 'vitest';
import { assertPublicHttpsUrl, validateOidcDiscovery } from '../../src/sso-management/provider-validation.service';

describe('OIDC discovery SSRF preflight', () => {
  it.each([
    'http://login.microsoftonline.com/tenant/v2.0',
    'https://localhost',
    'https://127.0.0.1',
    'https://[::1]/',
    'https://169.254.169.254/latest/meta-data',
    'https://metadata.google.internal',
    'https://example.local',
    'https://admin:password@login.microsoftonline.com',
    'https://login.microsoftonline.com:8443',
    'https://login.microsoftonline.com/#fragment',
  ])('rejects unsafe issuer %s', (url) => {
    expect(() => assertPublicHttpsUrl(url)).toThrow();
  });

  it('accepts a public HTTPS issuer', () => {
    expect(assertPublicHttpsUrl('https://login.microsoftonline.com/common/v2.0').hostname)
      .toBe('login.microsoftonline.com');
  });

  it('requires strict issuer equality, code flow and PKCE S256', () => {
    const issuer = 'https://login.microsoftonline.com/common/v2.0';
    const metadata = {
      issuer,
      authorization_endpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      token_endpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      jwks_uri: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
    };
    expect(validateOidcDiscovery(issuer, metadata).issuer).toBe(issuer);
    expect(() => validateOidcDiscovery(issuer, { ...metadata, issuer: 'https://evil.com' })).toThrow();
    expect(() => validateOidcDiscovery(issuer, { ...metadata, jwks_uri: 'https://127.0.0.1/jwks' })).toThrow();
    expect(() => validateOidcDiscovery(issuer, { ...metadata, code_challenge_methods_supported: [] })).toThrow();
  });
});
