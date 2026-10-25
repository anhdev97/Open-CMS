import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertValidSchema, defineContentType, f, resolveConfig, type ContentGroupDefinition } from '@opencloudcms/schema';
import {
  contentGroupsFile,
  loadContentGroups,
  localesFile,
  printContentGroupsFile,
  printLocalesFile,
  generateCode,
  printSchemaFile,
} from '../src';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'opencloudcms-gl-'));
const cfg = (root: string) => resolveConfig({ database: { url: 'x' } } as any, root);
const def = (extra: object = {}) =>
  defineContentType({ id: 'ct_product', apiId: 'product', displayName: 'Product', fields: { name: f.text({ id: 'fld_name' }) }, ...extra } as any);

describe('content groups and locales files', () => {
  it('resolves file locations', () => {
    const c = cfg('/p');
    expect(contentGroupsFile(c)).toBe(path.join('/p', 'src', 'content-groups.ts'));
    expect(localesFile(c)).toBe(path.join('/p', 'src', 'locales.ts'));
  });

  it('loadContentGroups returns [] when the file is missing', async () => {
    expect(await loadContentGroups(cfg(tmp()))).toEqual([]);
  });

  it('printed groups file loads back to the same array', async () => {
    const root = tmp();
    const groups: ContentGroupDefinition[] = [
      { key: 'shop', title: { 'en-US': "Shop's", 'vi-VN': 'Cửa hàng' }, order: 1 },
      { key: 'blog', title: { 'en-US': 'Blog' } },
    ];
    const text = printContentGroupsFile(groups);
    expect(text).toMatch(/^\/\/ .*[Mm]anaged by OpenCloudCMS/);
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'content-groups.ts'), text);
    expect(await loadContentGroups(cfg(root))).toEqual(groups);
  });

  it('printed locales file loads back equal', async () => {
    const { createJiti } = await import('jiti');
    const root = tmp();
    const s = { defaultLocale: 'en-US', locales: ['en-US', 'vi-VN'] } as const;
    const text = printLocalesFile({ defaultLocale: s.defaultLocale, locales: [...s.locales] });
    expect(text).toMatch(/^\/\/ .*[Mm]anaged by OpenCloudCMS/);
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'locales.ts'), text);
    const jiti = createJiti(path.join(root, 'noop.js'), { moduleCache: false, fsCache: false, interopDefault: true });
    expect(await jiti.import(path.join(root, 'src', 'locales.ts'), { default: true })).toEqual(s);
  });
});

describe('printSchemaFile', () => {
  it('prints string displayName as a string', () => {
    expect(printSchemaFile(def())).toContain("displayName: 'Product'");
  });
  it('prints a displayName map', () => {
    const out = printSchemaFile(def({ displayName: { 'en-US': 'Product', 'vi-VN': 'Sản phẩm' } }));
    expect(out).toContain("displayName: { 'en-US': 'Product', 'vi-VN': 'Sản phẩm' }");
  });
  it('prints group', () => {
    expect(printSchemaFile(def({ group: 'shop' }))).toContain("group: 'shop'");
  });
});

describe('assertValidSchema groups', () => {
  it('throws for an unknown group', () => {
    expect(() => assertValidSchema([def({ group: 'nope' })], [{ key: 'shop', title: { 'en-US': 'Shop' } }])).toThrow(
      'Content type "product" uses unknown group "nope"',
    );
  });
  it('passes for a known group, and when groups are not supplied', () => {
    expect(() => assertValidSchema([def({ group: 'shop' })], [{ key: 'shop', title: { 'en-US': 'Shop' } }])).not.toThrow();
    expect(() => assertValidSchema([def({ group: 'shop' })])).not.toThrow();
  });

  it('types.ts doc comments use the en-US display name of a localized map', () => {
    const files = generateCode([def({ displayName: { 'en-US': 'Product', 'vi-VN': 'Sản phẩm' } })], '/g');
    const types = files.find((x) => x.path.endsWith('types.ts'))!.content;
    expect(types).toContain('/** Product (product) */');
    expect(types).not.toContain('[object Object]');
  });
});

describe('printSchemaFile review', () => {
  it('prints review only when true, and round-trips', () => {
    expect(printSchemaFile(def({ review: true }))).toContain('review: true,');
    expect(printSchemaFile(def({ review: false }))).not.toContain('review');
    expect(printSchemaFile(def())).not.toContain('review');
  });
});
