import { describe, expect, it } from 'vitest';
import { adminHref } from '../../admin/src/lib/admin-href';

describe('adminHref', () => {
  it('prefixes /admin', () => {
    expect(adminHref('/')).toBe('/admin');
    expect(adminHref('/content/x')).toBe('/admin/content/x');
    expect(adminHref('/builder?type=a')).toBe('/admin/builder?type=a');
    expect(adminHref('builder')).toBe('/admin/builder');
  });
  it('never doubles the prefix', () => {
    expect(adminHref('/admin/x')).toBe('/admin/x');
  });
});
