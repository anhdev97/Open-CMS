import { describe, it, expect } from 'vitest';
import { assertSameOrigin } from '../../src/security/origin';

const pub = 'https://cms.x.com';
describe('assertSameOrigin', () => {
  it('throws for undefined/garbage/other origin', () => {
    for (const h of [undefined, 'not a url', 'https://evil.com', 'http://cms.x.com']) {
      expect(() => assertSameOrigin(h, pub)).toThrowError(expect.objectContaining({ code: 'origin_mismatch', status: 403 }));
    }
  });
  it('accepts equal and normalised origins', () => {
    expect(() => assertSameOrigin('https://cms.x.com', pub)).not.toThrow();
    expect(() => assertSameOrigin('https://cms.x.com:443', pub)).not.toThrow();
    expect(() => assertSameOrigin('https://cms.x.com', 'https://cms.x.com/')).not.toThrow();
  });
});
