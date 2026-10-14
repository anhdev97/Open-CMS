import { describe, expect, it } from 'vitest';
import { defineContentType, f } from '@opencms/schema';
import { compileStatement, DiffError, diffSchemas, planMigration } from '../src';

const product = (fields: Parameters<typeof defineContentType>[0]['fields'], apiId = 'product') =>
  defineContentType({ id: 'ct_product', apiId, displayName: 'Product', fields });

const base = product({
  name: f.text({ id: 'fld_name', required: true, localizable: true, indexed: true }),
  slug: f.slug({ id: 'fld_slug', unique: true }),
  price: f.money({ id: 'fld_price' }),
  images: f.asset({ id: 'fld_images', multiple: true }),
});

const sqlOf = (prev: any[], next: any[]) => {
  const plan = planMigration(diffSchemas(prev, next).operations, '20260101000000');
  return { up: plan.up.map(compileStatement), down: plan.down.map(compileStatement), plan };
};

describe('diffSchemas', () => {
  it('creates main, l10n and relation tables for a new type', () => {
    const { up, down } = sqlOf([], [base]);
    expect(up[0]).toContain('create table "ct_product"');
    expect(up[0]).toContain('"price_amount" numeric(19, 4)');
    expect(up.some((s) => s.includes('create table "ct_product_l10n"') && s.includes('"name" varchar(255)'))).toBe(true);
    expect(up.some((s) => s.includes('create table "ct_product__rel__images"'))).toBe(true);
    expect(up.some((s) => s.includes('create unique index "ct_product_slug_uq"'))).toBe(true);
    expect(down.at(-1)).toBe('drop table "ct_product"');
  });

  it('treats a changed name with the same id as a rename, not drop + add', () => {
    const next = { ...base, fields: base.fields.map((x) => (x.id === 'fld_slug' ? { ...x, name: 'handle' } : x)) };
    const { up, down } = sqlOf([base], [next]);
    expect(up).toContain('alter table "ct_product" rename column "slug" to "handle"');
    expect(up).toContain('alter index "ct_product_slug_uq" rename to "ct_product_handle_uq"');
    expect(down).toContain('alter table "ct_product" rename column "handle" to "slug"');
  });

  it('archives dropped fields instead of dropping data', () => {
    const next = { ...base, fields: base.fields.filter((x) => x.id !== 'fld_slug') };
    const { up, down, plan } = sqlOf([base], [next]);
    expect(up[0]).toBe('drop index "ct_product_slug_uq"');
    expect(up[1]).toBe('alter table "ct_product" rename column "slug" to "_del20260101000000_slug"');
    expect(down[0]).toBe('alter table "ct_product" rename column "_del20260101000000_slug" to "slug"');
    expect(plan.warnings.join()).toContain('archived');
  });

  it('renames every table and index when the apiId changes', () => {
    const next = { ...base, apiId: 'item' };
    const { up } = sqlOf([base], [next]);
    expect(up).toContain('alter table "ct_product" rename to "ct_item"');
    expect(up).toContain('alter table "ct_product__rel__images" rename to "ct_item__rel__images"');
    expect(up).toContain('alter index "ct_product_pkey" rename to "ct_item_pkey"');
  });

  it('allows widening and rejects narrowing', () => {
    const widen = { ...base, fields: base.fields.map((x) => (x.id === 'fld_slug' ? { ...x, options: { maxLength: 500 } } : x)) };
    expect(sqlOf([base], [widen]).up).toContain(
      'alter table "ct_product" alter column "slug" type varchar(500) using "slug"::varchar(500)',
    );
    const narrow = { ...base, fields: base.fields.map((x) => (x.id === 'fld_slug' ? { ...x, options: { maxLength: 10 } } : x)) };
    expect(() => diffSchemas([base], [narrow])).toThrow(DiffError);
  });

  it('rejects storage-changing kind switches', () => {
    const next = { ...base, fields: base.fields.map((x) => (x.id === 'fld_slug' ? { ...x, kind: 'asset' as const, options: {} } : x)) };
    expect(() => diffSchemas([base], [next])).toThrow(/storage layout/);
  });

  it('reports metadata-only changes without DDL', () => {
    const next = { ...base, displayName: 'Products', fields: base.fields.map((x) => ({ ...x, label: 'L' })) };
    const r = diffSchemas([base], [next]);
    expect(r.operations).toHaveLength(0);
    expect(r.changed).toBe(true);
  });
});
