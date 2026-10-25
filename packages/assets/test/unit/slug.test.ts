import { describe, expect, it } from 'vitest';
import { slugifyFilename } from '../../src/seo/slug';

describe('slugifyFilename', () => {
  it('slugifies unicode and keeps extension', () => {
    expect(slugifyFilename('Ảnh Sản Phẩm.JPG')).toEqual({ slug: 'anh-san-pham', ext: 'jpg' });
  });
  it('uses extOverride', () => {
    expect(slugifyFilename('Photo.PNG', 'webp')).toEqual({ slug: 'photo', ext: 'webp' });
  });
  it('falls back when name is symbols only', () => {
    expect(slugifyFilename('!!!').slug).toBe('file');
  });
});
