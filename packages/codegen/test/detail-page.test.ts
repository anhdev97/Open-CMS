import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as schemaPkg from '@opencloudcms/schema';
import { defineContentType, f, resolveConfig, type ContentTypeDefinition } from '@opencloudcms/schema';
import { createMigration, diffSchemas, loadDefinitions, previewChange, printSchemaFile, writeSchemaChange } from '../src';

const product = (extra: Record<string, unknown> = {}, slug: Record<string, unknown> = {}) =>
  defineContentType({
    id: 'ct_product',
    apiId: 'product',
    displayName: 'Product',
    ...extra,
    fields: {
      name: f.text({ id: 'fld_name', required: true }),
      slug: f.slug({ id: 'fld_slug', ...slug } as any),
    },
  } as any);

const evalSchema = (src: string): ContentTypeDefinition => {
  const body = src.replace(/^import .*$/m, '').replace('export default ', 'return ');
  return new Function('defineContentType', 'f', body)(schemaPkg.defineContentType, schemaPkg.f);
};

describe('printSchemaFile: detailPage and slug pattern', () => {
  it('prints detailPage with slugField and round-trips byte-identically', () => {
    const def = product({ detailPage: { path: '/products/{slug}', slugField: 'slug' } }, { pattern: '{name}-{id6}', maxLength: 80 });
    const src = printSchemaFile(def);
    expect(src).toContain("  detailPage: { path: '/products/{slug}', slugField: 'slug' },");
    expect(src).toContain("slug: f.slug({ id: 'fld_slug', pattern: '{name}-{id6}', maxLength: 80 }),");
    // detailPage sits with the other type options, before the fields
    expect(src.indexOf('detailPage')).toBeLessThan(src.indexOf('fields: {'));
    const again = evalSchema(src);
    expect(again).toEqual(def);
    expect(printSchemaFile(again)).toBe(src);
  });

  it('prints an {id} detail page without slugField', () => {
    const def = product({ detailPage: { path: '/posts/{id}' } });
    const src = printSchemaFile(def);
    expect(src).toContain("  detailPage: { path: '/posts/{id}' },");
    expect(evalSchema(src)).toEqual(def);
  });

  it('keeps legacy `from` as is (not rewritten to a pattern)', () => {
    const def = product({}, { from: 'name' });
    const src = printSchemaFile(def);
    expect(src).toContain("slug: f.slug({ id: 'fld_slug', from: 'name' }),");
    expect(src).not.toContain('pattern');
    expect(printSchemaFile(evalSchema(src))).toBe(src);
  });

  it('omits detailPage when unset (existing files unchanged)', () => {
    expect(printSchemaFile(product())).not.toContain('detailPage');
  });
});

describe('detailPage and slug pattern are metadata only', () => {
  it('diff: adding/changing/removing them emits no operations but counts as changed', () => {
    const plain = product();
    const withDetail = product({ detailPage: { path: '/products/{slug}', slugField: 'slug' } }, { pattern: '{name}' });
    const moved = product({ detailPage: { path: '/shop/{slug}', slugField: 'slug' } }, { pattern: '{name}-{id6}' });
    for (const [a, b] of [[plain, withDetail], [withDetail, moved], [moved, plain]]) {
      const r = diffSchemas([a], [b]);
      expect(r.operations).toEqual([]);
      expect(r.changed).toBe(true);
    }
  });

  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  /** A project whose schema files resolve `@opencloudcms/schema` (node_modules linked from this package). */
  const project = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencloudcms-detail-'));
    dirs.push(root);
    fs.symlinkSync(path.resolve(__dirname, '../node_modules'), path.join(root, 'node_modules'), 'dir');
    return resolveConfig({ database: { url: 'x' } } as any, root);
  };

  it('pipeline: a Builder save keeps detailPage and the slug pattern, with no migration file', async () => {
    const config = project();
    const first = await writeSchemaChange(config, { upsert: product() });
    const created = await createMigration(config, { definitions: first.definitions, now: new Date('2026-11-27T00:00:00Z') });
    expect(created.status).toBe('created');
    const migrations = () => fs.readdirSync(config.migrationsDir).filter((f) => f.endsWith('.ts')).sort();
    expect(migrations()).toHaveLength(1);

    const next = product({ detailPage: { path: '/products/{slug}', slugField: 'slug' } }, { pattern: '{name}-{id6}' });
    const preview = await previewChange(config, { upsert: next });
    expect(preview.diff.changed).toBe(true);
    expect(preview.sql).toEqual([]);

    const written = await writeSchemaChange(config, { upsert: next });
    const r = await createMigration(config, { definitions: written.definitions, now: new Date('2026-11-27T00:00:10Z') });
    expect(r.status).toBe('metadata-only');
    expect(migrations()).toHaveLength(1);

    const [loaded] = await loadDefinitions(config);
    expect(loaded.def.detailPage).toEqual({ path: '/products/{slug}', slugField: 'slug' });
    expect(loaded.def.fields.find((x) => x.name === 'slug')?.options).toMatchObject({ pattern: '{name}-{id6}' });
    expect(loaded.def).toEqual(next);
    // The snapshot holds the new metadata: saving again is up to date.
    const again = await createMigration(config, { definitions: (await loadDefinitions(config)).map((l) => l.def) });
    expect(again.status).toBe('up-to-date');

    // Turning the detail page off is metadata only too.
    const off = await writeSchemaChange(config, { upsert: product({}, { pattern: '{name}-{id6}' }) });
    expect((await createMigration(config, { definitions: off.definitions })).status).toBe('metadata-only');
    expect((await loadDefinitions(config))[0].def.detailPage).toBeUndefined();
    expect(migrations()).toHaveLength(1);
  });

  it('pipeline: an invalid detailPage never touches the disk', async () => {
    const config = project();
    await writeSchemaChange(config, { upsert: product() });
    const file = path.join(config.contentTypesDir, 'product', 'product.schema.ts');
    const before = fs.readFileSync(file, 'utf8');
    await expect(writeSchemaChange(config, { upsert: product({ detailPage: { path: '/products/{slug}' } }) })).rejects.toThrow(/slugField/);
    await expect(writeSchemaChange(config, { upsert: product({}, { pattern: '{nope}' }) })).rejects.toThrow(/nope/);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });
});
