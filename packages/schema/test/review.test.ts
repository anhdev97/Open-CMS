import { describe, expect, it } from 'vitest';
import { assertValidSchema, defineContentType, f, normalizeDefinition } from '../src';

const base = { id: 'ct_a', apiId: 'article', displayName: 'Article', fields: { title: f.text({ id: 'fld_a' }) } };

describe('content type review flag', () => {
  it('is carried by defineContentType and normalizeDefinition only when true', () => {
    expect(defineContentType({ ...base, review: true }).review).toBe(true);
    expect('review' in defineContentType({ ...base, review: false })).toBe(false);
    expect('review' in defineContentType(base)).toBe(false);
    expect(normalizeDefinition(defineContentType({ ...base, review: true })).review).toBe(true);
  });
  it('must be a boolean when present', () => {
    expect(() => assertValidSchema([defineContentType({ ...base, review: true })])).not.toThrow();
    expect(() => assertValidSchema([{ ...defineContentType(base), review: 'yes' as any }])).toThrow('review must be a boolean');
  });
});
