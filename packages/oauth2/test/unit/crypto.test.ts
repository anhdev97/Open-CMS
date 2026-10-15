import { describe, it, expect } from 'vitest';
import { deriveKey, seal, open, sha256 } from '../../src/security/crypto';

const secret = Buffer.alloc(32, 7);
describe('crypto', () => {
  it('round-trips', () => {
    const k = deriveKey(secret, 'token');
    expect(k.length).toBe(32);
    expect(open(k, seal(k, 'x'))).toBe('x');
  });
  it('throws when tampered', () => {
    const k = deriveKey(secret, 'token');
    const s = seal(k, 'hello');
    const i = s.length - 2;
    const t = s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1);
    expect(() => open(k, t)).toThrow();
  });
  it('different purposes give different keys', () => {
    expect(deriveKey(secret, 'token').equals(deriveKey(secret, 'key'))).toBe(false);
    expect(deriveKey(secret, 'token').equals(deriveKey(secret, 'token'))).toBe(true);
  });
  it('sha256 hex', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
