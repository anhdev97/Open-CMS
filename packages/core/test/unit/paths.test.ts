import { describe, expect, it } from 'vitest';
import { isAdminPath, isBackendPath } from '../../src/web/paths';

describe('isBackendPath', () => {
  it.each(['/api', '/api/', '/api/x', '/API/x', '/oauth2', '/oauth2/auth', '/OAuth2/x'])('%s is backend', (p) => {
    expect(isBackendPath(p)).toBe(true);
  });
  it.each(['/apix', '/oauth2x', '/', '/admin', '/_next/static/a.js'])('%s is not backend', (p) => {
    expect(isBackendPath(p)).toBe(false);
  });
});

describe('isAdminPath', () => {
  it.each(['/admin', '/admin/', '/admin/content/x', '/ADMIN'])('%s is admin', (p) => {
    expect(isAdminPath(p)).toBe(true);
  });
  it.each(['/administrator', '/admins', '/', '/api/admin'])('%s is not admin', (p) => {
    expect(isAdminPath(p)).toBe(false);
  });
});
