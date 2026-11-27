import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { defineContentType, f } from '@opencloudcms/schema';
import { loginAs } from '../../../oauth2/test/support/login';
import { ContentRegistry } from '../../src/registry.service';
import { SchemaWriteQueue } from '../../src/schema-write-queue';
import { createCoreTestApp, type CoreTestApp } from '../support/core-app';

const PW = 'correct horse battery';
const PAGES = '/api/admin/content/opencloudcmsPage';
const BLOCKS = '/api/admin/blocks';
// The CommonJS fs object that @opencloudcms/codegen (CJS build) writes through.
const cjsFs: typeof fs = createRequire(import.meta.url)('node:fs');

const product = defineContentType({
  id: 'ct_prod01',
  apiId: 'product',
  displayName: 'Product',
  fields: {
    name: f.text({ id: 'fld_name01' }),
    slug: f.slug({ id: 'fld_slug01', unique: true }),
    active: f.boolean({ id: 'fld_actv01', indexed: true }),
    color: f.text({ id: 'fld_colr01' }),
  },
});

const tile = (over: Record<string, unknown> = {}) => ({
  id: 'blk_tile01',
  name: 'ProductTile',
  label: { 'en-US': 'Product tile' },
  category: 'Shop',
  version: 1,
  binding: { apiId: 'product', mode: 'collection', limit: 8, layout: { kind: 'grid', columns: 3 }, urlPattern: '/products/{slug}' },
  fields: { cta: { kind: 'text', default: 'View' } },
  tree: {
    el: 'Card',
    children: [
      { el: 'Heading', bind: { text: { from: 'entry', path: 'name' } } },
      { el: 'Button', bind: { label: { from: 'field', name: 'cta' }, href: { from: 'entryUrl' } } },
    ],
  },
  ...over,
});

const banner = (name: string, id: string) => ({
  id,
  name,
  label: { 'en-US': name },
  category: 'Marketing',
  version: 1,
  fields: { title: { kind: 'text', default: 'Hi' } },
  tree: { el: 'Box', children: [{ el: 'Heading', bind: { text: { from: 'field', name: 'title' } } }] },
});

const content = (...types: string[]) => ({
  format: 'puck',
  formatVersion: 1,
  data: { root: {}, content: types.map((type, i) => ({ type, props: { id: `${type}-${i}` } })) },
});

/** Every file under `dir` -> its bytes (as a string). */
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = fs.readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

async function boot(opts: Parameters<typeof createCoreTestApp>[0]) {
  const t = await createCoreTestApp(opts);
  const setup = await fetch(`${t.baseUrl}/api/auth/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: t.url },
    body: JSON.stringify({ email: 'admin@example.com', name: 'Admin', password: PW }),
  });
  expect(setup.status).toBeLessThan(300);
  const cookie = `oc_session=${(await loginAs(t, 'admin@example.com', PW)).sessionCookie}`;
  const call = async (p: string, init: RequestInit = {}) => {
    const res = await fetch(`${t.baseUrl}${p}`, {
      ...init,
      headers: { cookie, 'content-type': 'application/json', origin: t.url, ...(init.headers as object) },
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  return { t, call };
}

const MANIFEST = [
  { name: 'Hero', version: 1 },
  { name: 'Text', version: 1, richText: ['content'] },
  { name: 'MyCustom', version: 3 },
];

describe('blocks API (editable)', () => {
  let t: CoreTestApp;
  let call: Awaited<ReturnType<typeof boot>>['call'];
  const put = (name: string, body: unknown) => call(`${BLOCKS}/${name}`, { method: 'PUT', body: JSON.stringify(body) });
  const page = async (title: string, types: string[], locale = 'en-US') => {
    const r = await call(`${PAGES}?locale=${locale}`, { method: 'POST', body: JSON.stringify({ title, path: `/${title.toLowerCase()}`, content: content(...types) }) });
    expect(r.status).toBe(201);
    return r.body.data.documentId as string;
  };
  const blocksDir = () => path.join(t.root, 'src', 'blocks');

  beforeAll(async () => {
    ({ t, call } = await boot({ locales: ['en-US', 'vi-VN'], pages: { blocks: MANIFEST.map((m) => ({ ...m })) } }));
    const ct = await call('/api/admin/content-types', { method: 'POST', body: JSON.stringify({ definition: product }) });
    expect(ct.status).toBe(200);
  }, 60_000);

  afterAll(async () => {
    await t?.close();
  });

  it('GET lists core and code blocks with usage counts (distinct pages, any locale or status)', async () => {
    const a = await page('Alpha', ['Hero', 'Hero', 'MyCustom']);
    await page('Beta', ['Hero'], 'vi-VN');
    expect((await call(`${PAGES}/${a}/publish`, { method: 'POST' })).status).toBe(200);
    const r = await call(BLOCKS);
    expect(r.status).toBe(200);
    expect(r.body.editable).toBe(true);
    expect(r.body.composedIndexWired).toBe(false);
    expect(r.body.loadErrors).toEqual([]);
    const by = Object.fromEntries(r.body.data.map((d: any) => [d.name, d]));
    expect(by.Hero).toMatchObject({ source: 'core', version: 1, usage: 2, problems: [] });
    expect(by.Text).toMatchObject({ source: 'core', usage: 0 });
    expect(by.MyCustom).toMatchObject({ name: 'MyCustom', source: 'code', version: 3, usage: 1, problems: [] });
    expect(by.MyCustom.file).toBeUndefined();
  });

  it('PUT a new block writes its file and composed.ts and updates the live manifest (publish works without restart)', async () => {
    const r = await put('ProductTile', { spec: tile() });
    expect(r.status).toBe(200);
    expect(r.body.files).toEqual(['src/blocks/product-tile/product-tile.block.ts', 'src/blocks/composed.ts']);
    expect(r.body.spec).toMatchObject({ name: 'ProductTile', version: 1 });
    expect(fs.readFileSync(path.join(blocksDir(), 'product-tile', 'product-tile.block.ts'), 'utf8')).toContain("name: 'ProductTile'");
    expect(fs.readFileSync(path.join(blocksDir(), 'composed.ts'), 'utf8')).toContain("import blockProductTile from './product-tile/product-tile.block';");

    const id = await page('Gamma', ['ProductTile', 'Hero']);
    const pub = await call(`${PAGES}/${id}/publish`, { method: 'POST' });
    expect(pub.status).toBe(200);

    const list = await call(BLOCKS);
    const pt = list.body.data.find((d: any) => d.name === 'ProductTile');
    expect(pt).toMatchObject({ source: 'composed', file: 'src/blocks/product-tile/product-tile.block.ts', version: 1, usage: 1, category: 'Shop', problems: [] });
    expect(pt.label).toEqual({ 'en-US': 'Product tile' });

    const one = await call(`${BLOCKS}/ProductTile`);
    expect(one.status).toBe(200);
    expect(one.body.spec).toEqual(r.body.spec);
    expect(one.body.file).toBe('src/blocks/product-tile/product-tile.block.ts');
    expect((await call(`${BLOCKS}/Hero`)).body.error.code).toBe('not_composed');
    expect((await call(`${BLOCKS}/Hero`)).status).toBe(409);
    expect((await call(`${BLOCKS}/NoSuchBlock`)).status).toBe(404);
  });

  it('PUT an invalid spec -> 422 with issues', async () => {
    const r = await put('ProductTile', { spec: tile({ tree: { el: 'Nope' } }) });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('invalid_block');
    expect(r.body.error.issues).toContainEqual({ path: ['tree', 'el'], message: 'unknown element "Nope"' });
    expect((await put('ProductTile', {})).status).toBe(422);
  });

  it('PUT with a filter on a non-indexed field -> 422', async () => {
    const spec = tile({ binding: { ...tile().binding, filter: [{ field: 'color', value: 'red' }] } });
    const r = await put('ProductTile', { spec });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('invalid_block');
    expect(r.body.error.issues).toEqual([
      { path: ['binding', 'filter', 0, 'field'], message: 'field "color" is not indexed; filters need an indexed or unique field' },
    ]);
  });

  it('PUT a name of a core or code block -> 409 block_name_taken', async () => {
    for (const name of ['Hero', 'MyCustom']) {
      const r = await put(name, { spec: banner(name, 'blk_taken1') });
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('block_name_taken');
    }
    // A different composed block (other id) under an existing composed name.
    const r = await put('ProductTile', { spec: tile({ id: 'blk_other1' }) });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('block_name_taken');
    expect(fs.existsSync(path.join(blocksDir(), 'hero'))).toBe(false);
  });

  it('renaming an existing block -> 422 name_immutable', async () => {
    const a = await put('ProductTile', { spec: tile({ name: 'ProductCard' }) });
    expect(a.status).toBe(422);
    expect(a.body.error.code).toBe('name_immutable');
    const b = await put('ProductCard', { spec: tile({ name: 'ProductCard' }) });
    expect(b.status).toBe(422);
    expect(b.body.error.code).toBe('name_immutable');
    expect(fs.existsSync(path.join(blocksDir(), 'product-card'))).toBe(false);
  });

  it('a breaking change of a used block needs confirmBreaking, then bumps the version', async () => {
    const single = tile({ binding: { apiId: 'product', mode: 'single', urlPattern: '/products/{slug}' } });
    const r = await put('ProductTile', { spec: single });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('block_in_use');
    expect(r.body.error.issues).toEqual([{ path: ['ProductTile'], message: '1' }]);
    // Only the boolean true confirms.
    for (const confirmBreaking of ['false', 1, 'true']) {
      const x = await put('ProductTile', { spec: single, confirmBreaking });
      expect(x.status).toBe(409);
      expect(x.body.error.code).toBe('block_in_use');
    }
    expect(fs.readFileSync(path.join(blocksDir(), 'product-tile', 'product-tile.block.ts'), 'utf8')).toContain("mode: 'collection'");

    const ok = await put('ProductTile', { spec: single, confirmBreaking: true });
    expect(ok.status).toBe(200);
    expect(ok.body.spec.version).toBe(2);
    expect(fs.readFileSync(path.join(blocksDir(), 'product-tile', 'product-tile.block.ts'), 'utf8')).toContain('version: 2');
    // A non-breaking change keeps the version.
    const label = await put('ProductTile', { spec: { ...single, version: 2, label: { 'en-US': 'Tile' } } });
    expect(label.status).toBe(200);
    expect(label.body.spec.version).toBe(2);
  });

  it('PUTs fired at once all land in composed.ts (writes are serialized)', async () => {
    const names = ['BannerOne', 'BannerTwo', 'BannerThree', 'BannerFour', 'BannerFive', 'BannerSix'];
    const res = await Promise.all(names.map((n, i) => put(n, { spec: banner(n, `blk_ban00${i + 1}`) })));
    expect(res.map((r) => r.status)).toEqual(names.map(() => 200));
    const index = fs.readFileSync(path.join(blocksDir(), 'composed.ts'), 'utf8');
    for (const n of [...names, 'ProductTile']) expect(index).toContain(`block${n}`);
  });

  it('block writes wait for the schema write queue shared with the Content Type Builder', async () => {
    const queue = t.app.get(SchemaWriteQueue);
    let release!: () => void;
    const gate = queue.run(() => new Promise<void>((r) => (release = r)));
    const pending = put('BannerSeven', { spec: banner('BannerSeven', 'blk_ban007') });
    try {
      await new Promise((r) => setTimeout(r, 300));
      expect(fs.existsSync(path.join(blocksDir(), 'banner-seven'))).toBe(false);
    } finally {
      release();
      await gate;
    }
    expect((await pending).status).toBe(200);
    expect(fs.readFileSync(path.join(blocksDir(), 'composed.ts'), 'utf8')).toContain('blockBannerSeven');
  });

  it('a failure while writing the index leaves every file as it was (and the manifest unchanged)', async () => {
    const before = tree(t.root);
    const real = cjsFs.writeFileSync;
    let thrown = false;
    const spy = vi.spyOn(cjsFs, 'writeFileSync').mockImplementation(((file: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
      if (!thrown && typeof file === 'string' && file.endsWith('composed.ts')) {
        thrown = true;
        throw new Error('disk full');
      }
      return (real as (...a: unknown[]) => void).call(cjsFs, file, ...rest);
    }) as typeof fs.writeFileSync);
    try {
      const r = await put('Failing', { spec: banner('Failing', 'blk_fail01') });
      expect(r.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect(thrown).toBe(true);
    expect(tree(t.root)).toEqual(before);
    const id = await page('Delta', ['Failing']);
    const pub = await call(`${PAGES}/${id}/publish`, { method: 'POST' });
    expect(pub.status).toBe(422);
    expect(pub.body.error.code).toBe('unknown_block');
    expect((await call(`${PAGES}/${id}`, { method: 'DELETE' })).status).toBe(200);
  });

  it('another broken composed block file -> 409 composed_blocks_broken, nothing written', async () => {
    const bad = path.join(blocksDir(), 'broken', 'broken.block.ts');
    fs.mkdirSync(path.dirname(bad), { recursive: true });
    fs.writeFileSync(bad, "import { defineComposedBlock } from '@opencloudcms/core/blocks';\nexport default defineComposedBlock({ name: 'Broken' });\n");
    try {
      const before = tree(t.root);
      const r = await put('BannerEight', { spec: banner('BannerEight', 'blk_ban008') });
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('composed_blocks_broken');
      expect(r.body.error.issues).toHaveLength(1);
      expect(r.body.error.issues[0].path).toEqual(['src/blocks/broken/broken.block.ts']);
      expect(typeof r.body.error.issues[0].message).toBe('string');
      expect(tree(t.root)).toEqual(before);
      const list = await call(BLOCKS);
      expect(list.status).toBe(200);
      expect(list.body.loadErrors.map((e: any) => e.file)).toEqual(['src/blocks/broken/broken.block.ts']);
    } finally {
      fs.rmSync(path.dirname(bad), { recursive: true, force: true });
    }
  });

  it('a composed block whose own file is broken stays composed and can be fixed by saving it', async () => {
    expect((await put('FixMe', { spec: banner('FixMe', 'blk_fixme1') })).status).toBe(200);
    const file = path.join(blocksDir(), 'fix-me', 'fix-me.block.ts');
    fs.writeFileSync(file, "import { defineComposedBlock } from '@opencloudcms/core/blocks';\nexport default defineComposedBlock({ name: 'FixMe' });\n");
    const list = await call(BLOCKS);
    const item = list.body.data.find((d: any) => d.name === 'FixMe');
    expect(item).toMatchObject({ source: 'composed', file: 'src/blocks/fix-me/fix-me.block.ts', version: 1 });
    expect(item.problems).toHaveLength(1);
    expect(item.problems[0]).toMatch(/^file does not load: /);
    expect(list.body.loadErrors.map((e: any) => e.file)).toEqual(['src/blocks/fix-me/fix-me.block.ts']);
    expect((await call(`${BLOCKS}/FixMe`)).body.error.code).toBe('composed_blocks_broken');

    const fixed = await put('FixMe', { spec: banner('FixMe', 'blk_fixme1') });
    expect(fixed.status).toBe(200);
    expect(fixed.body.spec.version).toBe(1);
    expect(fs.readFileSync(file, 'utf8')).toContain("name: 'FixMe'");
    expect(fs.readFileSync(file, 'utf8')).toContain("category: 'Marketing'");
    const after = await call(BLOCKS);
    expect(after.body.loadErrors).toEqual([]);
    expect(after.body.data.find((d: any) => d.name === 'FixMe')).toMatchObject({ source: 'composed', problems: [], label: { 'en-US': 'FixMe' } });
    expect((await call(`${BLOCKS}/FixMe`, { method: 'DELETE' })).status).toBe(200);
  });

  it('Content Type Builder preview warns about composed blocks that a change breaks', async () => {
    const spec = tile({ id: 'blk_actv01', name: 'ActiveProducts', binding: { ...tile().binding, filter: [{ field: 'active', value: true }] } });
    expect((await put('ActiveProducts', { spec })).status).toBe(200);
    expect((await call(BLOCKS)).body.data.find((d: any) => d.name === 'ActiveProducts').problems).toEqual([]);

    const without = { ...product, fields: product.fields.filter((x) => x.name !== 'active') };
    const plan = await call('/api/admin/content-types/plan', { method: 'POST', body: JSON.stringify({ definition: without }) });
    expect(plan.status).toBe(200);
    const w = plan.body.warnings.filter((x: string) => x.includes('ActiveProducts'));
    expect(w).toEqual(['Block "ActiveProducts": binding.filter.0.field: field "active" does not exist on "product"']);
    // Blocks that do not use the removed field are not mentioned.
    expect(plan.body.warnings.join('\n')).not.toContain('ProductTile');

    const removeType = await call('/api/admin/content-types/plan', { method: 'POST', body: JSON.stringify({ removeId: product.id }) });
    expect(removeType.body.warnings).toContain('Block "ActiveProducts": binding.apiId: unknown content type "product"');

    // Apply warns too (without blocking), and the block list then shows the problem.
    const applied = await call('/api/admin/content-types', { method: 'POST', body: JSON.stringify({ definition: without }) });
    expect(applied.status).toBe(200);
    expect(applied.body.warnings).toContain('Block "ActiveProducts": binding.filter.0.field: field "active" does not exist on "product"');
    const listed = (await call(BLOCKS)).body.data.find((d: any) => d.name === 'ActiveProducts');
    expect(listed.problems).toEqual(['binding.filter.0.field: field "active" does not exist on "product"']);
  });

  it('DELETE a used block -> 409 block_in_use; ?force=1 removes it and its manifest entry', async () => {
    const r = await call(`${BLOCKS}/ProductTile`, { method: 'DELETE' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('block_in_use');
    expect(r.body.error.issues).toEqual([{ path: ['ProductTile'], message: '1' }]);

    const ok = await call(`${BLOCKS}/ProductTile?force=1`, { method: 'DELETE' });
    expect(ok.status).toBe(200);
    expect(ok.body.files).toEqual(['src/blocks/product-tile/product-tile.block.ts', 'src/blocks/product-tile', 'src/blocks/composed.ts']);
    expect(fs.existsSync(path.join(blocksDir(), 'product-tile'))).toBe(false);
    expect(fs.readFileSync(path.join(blocksDir(), 'composed.ts'), 'utf8')).not.toContain('ProductTile');

    const id = await page('Epsilon', ['ProductTile']);
    const pub = await call(`${PAGES}/${id}/publish`, { method: 'POST' });
    expect(pub.status).toBe(422);
    expect(pub.body.error.code).toBe('unknown_block');

    expect((await call(`${BLOCKS}/Hero`, { method: 'DELETE' })).body.error.code).toBe('not_composed');
    expect((await call(`${BLOCKS}/Ghost`, { method: 'DELETE' })).status).toBe(404);
    // Unused composed block: no force needed.
    expect((await call(`${BLOCKS}/BannerOne`, { method: 'DELETE' })).status).toBe(200);
  });
  it('POST :name/eject writes .block.tsx, removes .block.ts, regenerates composed.ts; manifest unchanged', async () => {
    const saved = await put('Promo', { spec: banner('Promo', 'blk_promo1') });
    expect(saved.status).toBe(200);
    const id = await page('Zeta', ['Promo']);
    const r = await call(`${BLOCKS}/Promo/eject`, { method: 'POST' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      file: 'src/blocks/promo/promo.block.tsx',
      importLine: "import Promo from './promo/promo.block';",
      files: ['src/blocks/promo/promo.block.tsx', 'src/blocks/promo/promo.block.ts', 'src/blocks/composed.ts'],
    });
    expect(fs.existsSync(path.join(blocksDir(), 'promo', 'promo.block.ts'))).toBe(false);
    const tsx = fs.readFileSync(path.join(blocksDir(), 'promo', 'promo.block.tsx'), 'utf8');
    expect(tsx).toContain('export default defineBlock({');
    expect(tsx).toContain("const name = 'Promo';");
    expect(tsx).toContain('version: 1,');
    expect(fs.readFileSync(path.join(blocksDir(), 'composed.ts'), 'utf8')).not.toContain('Promo');
    // Same name/version in the live manifest: pages using it still publish.
    expect((await call(`${PAGES}/${id}/publish`, { method: 'POST' })).status).toBe(200);
    // No longer managed by the builder.
    const list = await call(BLOCKS);
    expect(list.body.data.find((d: any) => d.name === 'Promo')).toMatchObject({ source: 'code', version: 1 });
    expect((await call(`${BLOCKS}/Promo`)).body.error.code).toBe('not_composed');
    const again = await call(`${BLOCKS}/Promo/eject`, { method: 'POST' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('not_composed');
    expect((await call(`${BLOCKS}/Hero/eject`, { method: 'POST' })).body.error.code).toBe('not_composed');
    expect((await call(`${BLOCKS}/Nope/eject`, { method: 'POST' })).status).toBe(404);
  });

  it('eject: an existing .block.tsx -> 409, a failing index write -> every file restored', async () => {
    expect((await put('PromoTwo', { spec: banner('PromoTwo', 'blk_promo2') })).status).toBe(200);
    const mine = path.join(blocksDir(), 'promo-two', 'promo-two.block.tsx');
    fs.writeFileSync(mine, '// mine');
    let before = tree(t.root);
    const exists = await call(`${BLOCKS}/PromoTwo/eject`, { method: 'POST' });
    expect(exists.status).toBe(409);
    expect(exists.body.error.code).toBe('eject_target_exists');
    expect(tree(t.root)).toEqual(before);
    fs.rmSync(mine);

    before = tree(t.root);
    const real = cjsFs.writeFileSync;
    let thrown = false;
    const spy = vi.spyOn(cjsFs, 'writeFileSync').mockImplementation(((file: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
      if (!thrown && typeof file === 'string' && file.endsWith('composed.ts')) {
        thrown = true;
        throw new Error('disk full');
      }
      return (real as (...a: unknown[]) => void).call(cjsFs, file, ...rest);
    }) as typeof fs.writeFileSync);
    try {
      expect((await call(`${BLOCKS}/PromoTwo/eject`, { method: 'POST' })).status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect(thrown).toBe(true);
    expect(tree(t.root)).toEqual(before);
    expect((await call(`${BLOCKS}/PromoTwo`)).status).toBe(200);
  });

  // Spec §4: `entryUrl` without a urlPattern needs a content type with a detail page (server checks know the types).
  it('entryUrl without urlPattern -> 422 unless the type has a usable detail page', async () => {
    const binding = { apiId: 'product', mode: 'collection', limit: 8 };
    const spec = tile({ id: 'blk_tile09', name: 'AutoLinkTile', binding });
    const r = await put('AutoLinkTile', { spec });
    expect(r.status).toBe(422);
    expect(r.body.error.issues).toEqual([
      { path: ['tree', 'children', 1, 'bind', 'href'], message: "'entryUrl' requires binding.urlPattern or a content type with a detail page" },
    ]);
    const registry = t.app.get(ContentRegistry);
    const defs = registry.all().filter((d) => d.apiId !== 'opencloudcmsPage');
    registry.reload(defs.map((d) => (d.apiId === 'product' ? { ...d, detailPage: { path: '/products/{slug}', slugField: 'slug' } } : d)));
    try {
      expect((await put('AutoLinkTile', { spec })).status).toBe(200);
    } finally {
      registry.reload(defs);
    }
    expect((await call(`${BLOCKS}/AutoLinkTile?force=1`, { method: 'DELETE' })).status).toBe(200);
  });

  it('a CollectionList of an unknown type -> 422; its item paths are checked against the list type', async () => {
    const spec = (apiId: string, path = 'name') => ({
      ...banner('ListBanner', 'blk_lstb01'),
      tree: {
        el: 'Box',
        children: [
          { el: 'Heading', bind: { text: { from: 'field', name: 'title' } } },
          { el: 'CollectionList', props: { key: 'list', apiId, urlPattern: '/p/{slug}' }, children: [{ el: 'Heading', bind: { text: { from: 'entry', path } } }] },
        ],
      },
    });
    const unknown = await put('ListBanner', { spec: spec('nope') });
    expect(unknown.status).toBe(422);
    expect(unknown.body.error.issues).toEqual([{ path: ['tree', 'children', 1, 'props', 'apiId'], message: 'unknown content type "nope"' }]);
    const badPath = await put('ListBanner', { spec: spec('product', 'missing') });
    expect(badPath.status).toBe(422);
    expect(badPath.body.error.issues).toEqual([
      { path: ['tree', 'children', 1, 'children', 0, 'bind', 'text', 'path'], message: 'field "missing" does not exist on "product"' },
    ]);
  });
});

describe('blocks API (not editable)', () => {
  let t: CoreTestApp;
  let call: Awaited<ReturnType<typeof boot>>['call'];

  beforeAll(async () => {
    ({ t, call } = await boot({ schemaEditable: false, pages: { blocks: [{ name: 'Hero', version: 1 }] } }));
  }, 60_000);

  afterAll(async () => {
    await t?.close();
  });

  it('GET works, PUT and DELETE are refused like the Content Type Builder', async () => {
    const list = await call(BLOCKS);
    expect(list.status).toBe(200);
    expect(list.body.editable).toBe(false);
    const put = await call(`${BLOCKS}/BannerOne`, { method: 'PUT', body: JSON.stringify({ spec: banner('BannerOne', 'blk_ban001') }) });
    expect(put.status).toBe(403);
    expect(put.body.error.message).toBe('Schema editing is disabled (production mode). Change schema files in git and deploy migrations.');
    const del = await call(`${BLOCKS}/BannerOne`, { method: 'DELETE' });
    expect(del.status).toBe(403);
    const ej = await call(`${BLOCKS}/BannerOne/eject`, { method: 'POST' });
    expect(ej.status).toBe(403);
    expect(ej.body.error.message).toBe('Schema editing is disabled (production mode). Change schema files in git and deploy migrations.');
    expect(fs.existsSync(path.join(t.root, 'src', 'blocks'))).toBe(false);
  });
});
