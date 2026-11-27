import { describe, expect, it } from 'vitest';
import { defineContentType, f } from '../src/define';
import { parseSlugPattern, renderSlugPattern, SLUG_RE, slugify, slugPattern } from '../src/slug';
import { collectSchemaIssues } from '../src/validate';

const ID = '3f9a2c1e-7b4d-4e2a-9c1f-0a1b2c3d4e5f';
const product = (slug: Record<string, unknown> = {}) => defineContentType({
  id: 'ct_product', apiId: 'product', displayName: 'Product',
  fields: {
    name: f.text({ id: 'fld_name' }),
    category: f.text({ id: 'fld_cat' }),
    body: f.richText({ id: 'fld_body' }),
    price: f.number({ id: 'fld_price' }),
    tags: f.taxonomy({ id: 'fld_tags', taxonomy: 'tags' }),
    slug: f.slug({ id: 'fld_slug', ...slug }),
  },
});

describe('slugify', () => {
  it('produces SEO slugs', () => {
    expect(slugify('Áo Thun Trắng & Đen — Mùa Hè 2026!', 'vi')).toBe('ao-thun-trang-va-den-mua-he-2026');
    expect(slugify('Áo Thun Trắng & Đen', 'vi-VN')).toBe('ao-thun-trang-va-den');
    expect(slugify('Salt & Pepper', 'en')).toBe('salt-and-pepper');
    expect(slugify('Salt & Pepper', 'fr-FR')).toBe('salt-and-pepper');
    expect(slugify('🔥 Giảm giá 100.000₫ 🔥', 'vi')).toBe('giam-gia-100-000');
    expect(slugify('Price $5 € £ ¥', 'en')).toBe('price-5');
    expect(slugify('---', 'en')).toBe('');
    expect(slugify('  Hello   World  ', 'en')).toBe('hello-world');
  });

  it('cuts at a dash boundary within maxLength', () => {
    const title = 'The quick brown fox jumps over the lazy dog and keeps running far away from the old farm yard';
    expect(title.length).toBeGreaterThanOrEqual(90);
    const s = slugify(title, 'en');
    expect(s.length).toBeLessThanOrEqual(75);
    expect(s).toBe('the-quick-brown-fox-jumps-over-the-lazy-dog-and-keeps-running-far-away-from');
    expect(SLUG_RE.test(s)).toBe(true);
    expect(slugify(title, 'en', 73)).toBe('the-quick-brown-fox-jumps-over-the-lazy-dog-and-keeps-running-far-away');
    expect(slugify('abcdefghij', 'en', 4)).toBe('abcd');
    expect(slugify('abc def', 'en', 7)).toBe('abc-def');
    expect(slugify('abc def', 'en', 6)).toBe('abc');
  });

  it('SLUG_RE accepts slugs and document ids', () => {
    expect(SLUG_RE.test('ao-thun')).toBe(true);
    expect(SLUG_RE.test(ID)).toBe(true);
    for (const bad of ['', '-a', 'a-', 'a--b', 'A', 'a b', 'á']) expect(SLUG_RE.test(bad)).toBe(false);
  });
});

describe('slug patterns', () => {
  it('reads the pattern, maps legacy from, and is null without either', () => {
    const field = (o: Record<string, unknown>) => product(o).fields.find((x) => x.name === 'slug')!;
    expect(slugPattern(field({}))).toBeNull();
    expect(slugPattern(field({ pattern: '{name}-{id6}' }))).toBe('{name}-{id6}');
    expect(slugPattern(field({ from: 'name' }))).toBe('{name}');
    expect(slugPattern(field({ from: 'name', pattern: '{category}' }))).toBe('{category}');
    expect(slugPattern(product().fields[0])).toBeNull();
  });

  it('parses placeholders', () => {
    const { parts, issues } = parseSlugPattern('{category}-{name}-{id6}', product());
    expect(issues).toEqual([]);
    expect(parts).toEqual([
      { kind: 'field', name: 'category' }, { kind: 'text', value: '-' }, { kind: 'field', name: 'name' },
      { kind: 'text', value: '-' }, { kind: 'id6' },
    ]);
    expect(parseSlugPattern('{id}', product()).issues).toEqual([]);
    expect(parseSlugPattern('{price}-{tags}', product()).issues).toEqual([]);
  });

  it('reports bad patterns', () => {
    expect(parseSlugPattern('{nope}', product()).issues).toEqual(['unknown placeholder "{nope}"']);
    expect(parseSlugPattern('{body}', product()).issues[0]).toMatch(/cannot be used/);
    expect(parseSlugPattern('{slug}', product()).issues[0]).toMatch(/cannot be used/);
    expect(parseSlugPattern('', product()).issues[0]).toMatch(/placeholder/);
    expect(parseSlugPattern('static', product()).issues[0]).toMatch(/placeholder/);
    expect(parseSlugPattern('{name', product()).issues[0]).toMatch(/unclosed/);
    expect(parseSlugPattern('{name} x', product()).issues[0]).toMatch(/text/);
  });

  it('renders patterns', () => {
    const v = { name: 'Áo Thun Trắng', category: 'Áo' };
    expect(renderSlugPattern('{name}', v, ID, 'vi', 75)).toBe('ao-thun-trang');
    expect(renderSlugPattern('{name}-{id6}', v, ID, 'vi', 75)).toBe('ao-thun-trang-3f9a2c');
    expect(renderSlugPattern('{name}-{id6}', v, ID, 'vi', 75, 8)).toBe('ao-thun-trang-3f9a2c1e');
    expect(renderSlugPattern('{category}-{name}', v, ID, 'vi', 75)).toBe('ao-ao-thun-trang');
    expect(renderSlugPattern('{id}', v, ID, 'vi', 75)).toBe(ID);
    expect(renderSlugPattern('p-{name}', v, ID, 'vi', 75)).toBe('p-ao-thun-trang');
    expect(renderSlugPattern('{category}-{name}', { name: 'Áo' }, ID, 'vi', 75)).toBe('ao');
    expect(renderSlugPattern('{name}', {}, ID, 'vi', 75)).toBe('');
    expect(renderSlugPattern('{price}-{tags}', { price: 12, tags: [{ name: 'Mùa hè' }] }, ID, 'vi', 75)).toBe('12-mua-he');
  });

  it('keeps the id part when cutting', () => {
    const name = 'word '.repeat(30);
    const s = renderSlugPattern('{name}-{id6}', { name }, ID, 'en', 20);
    expect(s).toBe('word-word-3f9a2c');
    expect(renderSlugPattern('{name}', { name }, ID, 'en', 20)).toBe('word-word-word-word');
    expect(renderSlugPattern('{id}', { name }, ID, 'en', 20)).toBe(ID);
    expect(renderSlugPattern('{name}-{id}', { name }, ID, 'en', 37)).toBe(ID);
    expect(renderSlugPattern('{name}-{id}', { name }, ID, 'en', 45)).toBe(`word-${ID}`);
    expect(renderSlugPattern('{id6}', { name }, ID, 'en', 4, 8)).toBe('3f9a2c1e');
  });
});

describe('content type validation of slug options', () => {
  it('reports unknown placeholders and bad pattern types', () => {
    expect(collectSchemaIssues([product({ pattern: '{name}-{id6}' })])).toEqual([]);
    expect(collectSchemaIssues([product({ pattern: '{nope}' })])).toEqual([
      'content type "product", field "slug": unknown placeholder "{nope}"',
    ]);
    expect(collectSchemaIssues([product({ pattern: 3 })])).toEqual([
      'content type "product", field "slug": pattern must be a string',
    ]);
  });
  it('requires room for the id part', () => {
    expect(collectSchemaIssues([product({ pattern: '{name}-{id}', maxLength: 36 })])).toEqual([]);
    expect(collectSchemaIssues([product({ pattern: '{name}-{id}', maxLength: 35 })])).toEqual([
      'content type "product", field "slug": {id} needs maxLength of at least 36',
    ]);
    expect(collectSchemaIssues([product({ pattern: '{id6}', maxLength: 8 })])).toEqual([]);
    expect(collectSchemaIssues([product({ pattern: '{name}-{id6}', maxLength: 7 })])).toEqual([
      'content type "product", field "slug": {id6} needs maxLength of at least 8',
    ]);
    expect(parseSlugPattern('{id}', product(), 20).issues).toEqual(['{id} needs maxLength of at least 36']);
  });
  it('keeps the legacy from check unchanged', () => {
    expect(collectSchemaIssues([product({ from: 'name' })])).toEqual([]);
    expect(collectSchemaIssues([product({ from: 'missing' })])).toEqual([
      'content type "product", field "slug": slug source field "missing" does not exist',
    ]);
  });
});
