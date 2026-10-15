import { describe, it, expect } from 'vitest';
import { sanitizeReturnTo } from '../../src/security/return-to';

describe('sanitizeReturnTo', () => {
  it.each(['/admin', '/admin/x', '/admin/x?y=1#z', '/admin?a=1', '/admin#h'])('keeps %s', (v) => {
    expect(sanitizeReturnTo(v)).toBe(v);
  });
  it.each([undefined, '', '//evil.com', 'https://evil.com', '/api/x', '/admin\\@evil', '/\\evil',
    '/administrator', '/admin//evil.com', '/admin/\n', '/admin/x\r\nSet-Cookie: a'])('rejects %j', (v) => {
    expect(sanitizeReturnTo(v as string | undefined)).toBe('/admin');
  });
});
