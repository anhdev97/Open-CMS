import { describe, it, expect } from 'vitest';
import { PasswordService } from '../../src/security/password';

const svc = new PasswordService({ minLength: 12 });
const e = 'admin@x.com';
describe('PasswordService', () => {
  it('rejects too short', () => {
    expect(() => svc.validate('a'.repeat(11), e)).toThrowError(expect.objectContaining({ code: 'weak_password', status: 422 }));
  });
  it('rejects 257 chars but accepts 256', () => {
    expect(() => svc.validate('a'.repeat(257), e)).toThrowError(expect.objectContaining({ code: 'weak_password', status: 422 }));
    expect(() => svc.validate('a'.repeat(256), e)).not.toThrow();
  });
  it('rejects password equal to email case-insensitively', () => {
    expect(() => svc.validate('ADMIN@X.COM', e)).toThrowError(expect.objectContaining({ code: 'weak_password' }));
  });
  it('accepts a good password', () => {
    expect(() => svc.validate('correct horse battery', e)).not.toThrow();
  });
  it('does not trim', async () => {
    const h = await svc.hash('  pw with spaces  ');
    expect(await svc.verify(h, 'pw with spaces')).toBe(false);
    expect(await svc.verify(h, '  pw with spaces  ')).toBe(true);
  });
  it('verify returns false on malformed hash; verifyDummy false', async () => {
    expect(await svc.verify('garbage', 'x')).toBe(false);
    expect(await svc.verifyDummy('x')).toBe(false);
  });
});
