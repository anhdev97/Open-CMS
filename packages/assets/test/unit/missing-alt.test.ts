import { describe, expect, it } from 'vitest';
import { missingAlt } from '../../src/seo/missing-alt';

describe('missingAlt', () => {
  it('is true for image without alt', () => {
    expect(missingAlt({ mimeType: 'image/webp', alt: null })).toBe(true);
  });
  it('is false for image with alt', () => {
    expect(missingAlt({ mimeType: 'image/png', alt: 'Hero' })).toBe(false);
  });
  it('is false for non-image without alt', () => {
    expect(missingAlt({ mimeType: 'application/pdf', alt: null })).toBe(false);
  });
});
