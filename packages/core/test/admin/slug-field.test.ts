// Slug input of the entry form (collection list spec §2, plan Task 7).
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../admin/src/lib/api-error';
import type { ContentTypeDefinition, FieldDefinition } from '../../admin/src/lib/types';
import { generatedSlug } from '../../admin/src/pages/content/SlugField';
import { entrySchema, fieldIssues, writableBody } from '../../admin/src/pages/content/useEntry';

const fld = (name: string, kind: FieldDefinition['kind'], options: Record<string, unknown> = {}, extra: Partial<FieldDefinition> = {}): FieldDefinition => ({
  id: `fld_${name}`, name, kind, required: false, localizable: false, indexed: false, unique: false, options, ...extra,
});
const def: ContentTypeDefinition = {
  id: 'ct_product', apiId: 'product', displayName: 'Product',
  fields: [fld('name', 'text'), fld('slug', 'slug', { pattern: '{name}' }, { required: true }), fld('code', 'slug')],
};

describe('entry form slug', () => {
  it('a pattern slug shows the generated value; Regenerate sends an empty value', () => {
    expect(generatedSlug(def.fields[1]!, { name: 'Áo Thun Trắng' }, null, 'vi-VN')).toBe('ao-thun-trang');
    expect(writableBody(def, { name: 'Áo', slug: '', code: 'x' })).toEqual({ name: 'Áo', slug: '' });
  });

  it('a slug without a pattern is the entry id and never sent', () => {
    expect(generatedSlug(def.fields[2]!, {}, 'doc-1', 'en-US')).toBe('doc-1');
    expect(writableBody(def, { name: 'A', slug: 'a', code: 'doc-1' })).toEqual({ name: 'A', slug: 'a' });
  });

  it('a required slug may be left empty (the server fills it)', () => {
    expect(entrySchema(def).safeParse({ name: 'A', slug: '' }).success).toBe(true);
  });

  it('slug_taken shows inline on the slug field', () => {
    const e = new ApiError(422, 'slug_taken', 'Slug "a" is already used by another entry', [{ path: 'slug', message: 'already used' }]);
    expect(fieldIssues(def, e)).toEqual([{ field: def.fields[1], message: 'Another entry already uses this slug.' }]);
  });
});
