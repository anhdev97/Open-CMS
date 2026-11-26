import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfig, type ComposedBlockSpec } from '@opencloudcms/schema';
import {
  blocksDir,
  captureProjectFiles,
  ComposedBlockConflictError,
  ComposedBlockInvalidError,
  ComposedBlocksLoadError,
  composedBlockFile,
  isComposedIndexWired,
  loadComposedBlocks,
  printComposedBlockFile,
  printComposedIndex,
  restoreProjectFiles,
  writeComposedBlocks,
} from '../src';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'opencloudcms-blk-'));
const cfg = (root: string) => resolveConfig({ database: { url: 'x' } } as any, root);

const spec = (extra: Partial<ComposedBlockSpec> = {}): ComposedBlockSpec => ({
  id: 'blk_abc123',
  name: 'ProductCard',
  label: { 'en-US': "Product's card", 'vi-VN': 'Thẻ sản phẩm' },
  category: 'Shop',
  icon: 'box',
  version: 2,
  binding: {
    apiId: 'product',
    mode: 'collection',
    filter: [{ field: 'status', value: 'live' }],
    sort: { field: 'name', direction: 'asc' },
    limit: 12,
    layout: { kind: 'grid', columns: 3 },
    options: { editorFilter: true, emptyText: { 'en-US': 'Nothing' } },
  },
  fields: {
    badge: { kind: 'select', label: { 'en-US': 'Badge' }, default: 'new', options: ['new', 'sale'] },
    show: { kind: 'boolean', default: true },
  },
  tree: {
    el: 'Card',
    props: { padding: 'md' },
    children: [
      { el: 'Heading', bind: { text: { from: 'entry', path: 'name' } } },
      { el: 'Badge', bind: { text: { from: 'field', name: 'badge' } }, showIf: { from: 'field', name: 'show', is: 'present' } },
    ],
  },
  ...extra,
});

const project = (root: string, blocks: Record<string, string>) => {
  for (const [rel, text] of Object.entries(blocks)) {
    const f = path.join(root, 'src', 'blocks', rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  }
};

describe('composed block files', () => {
  it('resolves locations', () => {
    const c = cfg('/p');
    expect(blocksDir(c)).toBe(path.join('/p', 'src', 'blocks'));
    expect(composedBlockFile(c, 'ProductCard')).toBe(path.join('/p', 'src', 'blocks', 'product-card', 'product-card.block.ts'));
  });

  it('prints keys in a fixed order with a managed header', () => {
    const text = printComposedBlockFile(spec());
    expect(text).toMatch(/^\/\/ .*[Mm]anaged by OpenCloudCMS/);
    expect(text).toContain("import { defineComposedBlock } from '@opencloudcms/core/blocks';");
    const keys = ['id:', 'name:', 'label:', 'category:', 'icon:', 'version:', 'binding:', 'fields:', 'tree:'].map((k) => text.indexOf(`\n  ${k}`));
    expect(keys.every((k) => k > 0)).toBe(true);
    expect([...keys].sort((a, b) => a - b)).toEqual(keys);
    // input key order does not matter
    const shuffled = { tree: spec().tree, fields: spec().fields, version: 2, icon: 'box', category: 'Shop', label: spec().label, name: 'ProductCard', id: 'blk_abc123', binding: spec().binding } as ComposedBlockSpec;
    expect(printComposedBlockFile(shuffled)).toBe(text);
  });

  it('print -> load -> print is byte-identical', async () => {
    const root = tmp();
    const text = printComposedBlockFile(spec());
    project(root, { 'product-card/product-card.block.ts': text });
    const { specs, errors } = await loadComposedBlocks(cfg(root));
    expect(errors).toEqual([]);
    expect(specs).toHaveLength(1);
    expect(specs[0].spec).toEqual(spec());
    expect(printComposedBlockFile(specs[0].spec)).toBe(text);
  });

  it('prints an index sorted by name that loads', async () => {
    const root = tmp();
    const text = printComposedIndex([
      { name: 'Zed', importPath: './zed/zed.block' },
      { name: 'ProductCard', importPath: './product-card/product-card.block' },
    ]);
    expect(text.indexOf('ProductCard')).toBeLessThan(text.indexOf('Zed'));
    expect(text).toContain('export const composedBlocks');
    project(root, {
      'zed/zed.block.ts': printComposedBlockFile(spec({ id: 'blk_zed123', name: 'Zed' })),
      'product-card/product-card.block.ts': printComposedBlockFile(spec()),
      'composed.ts': text,
    });
    const jiti = (await import('jiti')).createJiti(path.join(root, 'x.js'), {
      moduleCache: false, fsCache: false, interopDefault: true,
      virtualModules: { '@opencloudcms/core/blocks': { defineComposedBlock: (s: unknown) => s } },
    });
    const mod: any = await jiti.import(path.join(root, 'src/blocks/composed.ts'));
    expect(mod.composedBlocks.map((b: any) => b.name)).toEqual(['ProductCard', 'Zed']);
  });

  it('collects invalid files as errors while other blocks still load; ignores hand-written blocks', async () => {
    const root = tmp();
    project(root, {
      'product-card/product-card.block.ts': printComposedBlockFile(spec()),
      'bad/bad.block.ts': printComposedBlockFile(spec({ id: 'blk_bad123', name: 'lower' })),
      'broken/broken.block.ts': "import { defineComposedBlock } from '@opencloudcms/core/blocks';\nexport default defineComposedBlock({ ;;",
      'hero/hero.block.tsx': "export default function Hero() { return null; }\n",
      'plain/plain.block.ts': "export default { name: 'Plain' };\n",
    });
    const { specs, errors } = await loadComposedBlocks(cfg(root));
    expect(specs.map((s) => s.spec.name)).toEqual(['ProductCard']);
    expect(errors.map((e) => e.file).sort()).toEqual([
      path.join(root, 'src/blocks/bad/bad.block.ts'),
      path.join(root, 'src/blocks/broken/broken.block.ts'),
    ]);
    expect(errors.every((e) => e.message.length > 0)).toBe(true);
  });

  it('returns nothing when src/blocks is missing', async () => {
    expect(await loadComposedBlocks(cfg(tmp()))).toEqual({ specs: [], errors: [] });
  });

  it('writeComposedBlocks upserts (file + composed.ts) and removes', async () => {
    const root = tmp();
    const c = cfg(root);
    const w1 = await writeComposedBlocks(c, { upsert: spec() });
    expect(w1).toContain(composedBlockFile(c, 'ProductCard'));
    expect(w1).toContain(path.join(root, 'src/blocks/composed.ts'));
    await writeComposedBlocks(c, { upsert: spec({ id: 'blk_aaa111', name: 'Alpha' }) });
    const index = fs.readFileSync(path.join(root, 'src/blocks/composed.ts'), 'utf8');
    expect(index.indexOf('Alpha')).toBeLessThan(index.indexOf('ProductCard'));
    expect(index).toContain("'./product-card/product-card.block'");

    const w2 = await writeComposedBlocks(c, { removeName: 'ProductCard' });
    expect(fs.existsSync(path.join(root, 'src/blocks/product-card'))).toBe(false);
    expect(w2).toContain(path.join(root, 'src/blocks/product-card'));
    expect(fs.readFileSync(path.join(root, 'src/blocks/composed.ts'), 'utf8')).not.toContain('ProductCard');
    expect((await loadComposedBlocks(c)).specs.map((s) => s.spec.name)).toEqual(['Alpha']);
  });

  it('writeComposedBlocks refuses and writes nothing when another block file is broken', async () => {
    const root = tmp();
    const c = cfg(root);
    await writeComposedBlocks(c, { upsert: spec() });
    const bad = path.join(root, 'src/blocks/bad/bad.block.ts');
    project(root, { 'bad/bad.block.ts': printComposedBlockFile(spec({ id: 'blk_bad123', name: 'lower' })) });
    const before = fs.readFileSync(path.join(root, 'src/blocks/composed.ts'), 'utf8');
    for (const change of [{ upsert: spec({ id: 'blk_aaa111', name: 'Alpha' }) }, { removeName: 'ProductCard' }]) {
      const err = await writeComposedBlocks(c, change).catch((e) => e);
      expect(err).toBeInstanceOf(ComposedBlocksLoadError);
      expect(err.errors.map((e: any) => e.file)).toEqual([bad]);
    }
    expect(fs.existsSync(path.join(root, 'src/blocks/alpha'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'src/blocks/product-card'))).toBe(true);
    expect(fs.readFileSync(path.join(root, 'src/blocks/composed.ts'), 'utf8')).toBe(before);
  });

  it('writeComposedBlocks may replace or remove the block whose own file is broken', async () => {
    const root = tmp();
    const c = cfg(root);
    project(root, { 'alpha/alpha.block.ts': "import { defineComposedBlock } from '@opencloudcms/core/blocks';\nexport default defineComposedBlock({ ;;" });
    await writeComposedBlocks(c, { upsert: spec({ id: 'blk_aaa111', name: 'Alpha' }) });
    expect((await loadComposedBlocks(c)).errors).toEqual([]);
    project(root, { 'alpha/alpha.block.ts': "import { defineComposedBlock } from '@opencloudcms/core/blocks';\nexport default defineComposedBlock({ ;;" });
    await writeComposedBlocks(c, { removeName: 'Alpha' });
    expect(fs.existsSync(path.join(root, 'src/blocks/alpha'))).toBe(false);
  });

  it('removing a hand-placed block file leaves siblings and index.ts alone', async () => {
    const root = tmp();
    const c = cfg(root);
    project(root, {
      'foo.block.ts': printComposedBlockFile(spec({ id: 'blk_foo123', name: 'Foo' })),
      'index.ts': 'export const blocks = [];\n',
      'other/other.block.tsx': 'export default 1;\n',
    });
    await writeComposedBlocks(c, { removeName: 'Foo' });
    expect(fs.existsSync(path.join(root, 'src/blocks/foo.block.ts'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'src/blocks/index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'src/blocks/other/other.block.tsx'))).toBe(true);
  });

  it('keeps the block folder when it still holds other files', async () => {
    const root = tmp();
    const c = cfg(root);
    await writeComposedBlocks(c, { upsert: spec() });
    project(root, { 'product-card/notes.md': 'x' });
    await writeComposedBlocks(c, { removeName: 'ProductCard' });
    expect(fs.existsSync(path.join(root, 'src/blocks/product-card/notes.md'))).toBe(true);
  });

  it('rejects invalid input before touching anything', async () => {
    const root = tmp();
    const c = cfg(root);
    project(root, { 'index.ts': 'x\n' });
    for (const removeName of ['.', '..', '../x', 'lower', '']) {
      await expect(writeComposedBlocks(c, { removeName })).rejects.toBeInstanceOf(ComposedBlockInvalidError);
    }
    const err: any = await writeComposedBlocks(c, { upsert: spec({ name: 'bad' }) }).catch((e) => e);
    expect(err).toBeInstanceOf(ComposedBlockInvalidError);
    expect(err.issues.length).toBeGreaterThan(0);
    expect(fs.readdirSync(path.join(root, 'src/blocks'))).toEqual(['index.ts']);
  });

  it('rejects a kebab-case collision with another block', async () => {
    const root = tmp();
    const c = cfg(root);
    await writeComposedBlocks(c, { upsert: spec({ id: 'blk_html11', name: 'HtmlBlock' }) });
    const err = await writeComposedBlocks(c, { upsert: spec({ id: 'blk_html22', name: 'HTMLBlock' }) }).catch((e) => e);
    expect(err).toBeInstanceOf(ComposedBlockConflictError);
    expect((await loadComposedBlocks(c)).specs.map((s) => s.spec.id)).toEqual(['blk_html11']);
  });

  it('reports two files declaring the same name as load errors', async () => {
    const root = tmp();
    project(root, {
      'a/a.block.ts': printComposedBlockFile(spec()),
      'b/b.block.ts': printComposedBlockFile(spec({ id: 'blk_other1' })),
    });
    const { specs, errors } = await loadComposedBlocks(cfg(root));
    expect(specs).toEqual([]);
    expect(errors).toHaveLength(2);
    expect(errors[0].message).toMatch(/Duplicate block name "ProductCard"/);
  });

  it('restore keeps a pre-existing empty dir and binary files intact, removes only new dirs', async () => {
    const root = tmp();
    const c = cfg(root);
    const bin = Buffer.from([0xff, 0xfe, 0x00, 0x80, 0xc3, 0x28]);
    project(root, { 'keep/.gitkeep': '' });
    fs.mkdirSync(path.join(root, 'src/blocks/empty'));
    fs.writeFileSync(path.join(root, 'src/blocks/keep/data.bin'), bin);
    const snap = captureProjectFiles(c, [blocksDir(c)]);
    fs.writeFileSync(path.join(root, 'src/blocks/keep/data.bin'), 'changed');
    fs.mkdirSync(path.join(root, 'src/blocks/newdir/deep'), { recursive: true });
    restoreProjectFiles(c, snap, [blocksDir(c)]);
    expect(fs.readFileSync(path.join(root, 'src/blocks/keep/data.bin')).equals(bin)).toBe(true);
    expect(fs.existsSync(path.join(root, 'src/blocks/empty'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'src/blocks/newdir'))).toBe(false);
  });

  it('isComposedIndexWired checks src/blocks/index.ts', () => {
    const root = tmp();
    expect(isComposedIndexWired(cfg(root))).toBe(false);
    project(root, { 'index.ts': 'export const blocks = [];\n' });
    expect(isComposedIndexWired(cfg(root))).toBe(false);
    project(root, { 'index.ts': "import { composedBlocks } from './composed';\nexport const blocks = [...composedBlocks];\n" });
    expect(isComposedIndexWired(cfg(root))).toBe(true);
  });

  it('capture/restore with extraDirs covers the blocks directory', async () => {
    const root = tmp();
    const c = cfg(root);
    await writeComposedBlocks(c, { upsert: spec() });
    const snap = captureProjectFiles(c, [blocksDir(c)]);
    await writeComposedBlocks(c, { upsert: spec({ id: 'blk_aaa111', name: 'Alpha' }) });
    await writeComposedBlocks(c, { removeName: 'ProductCard' });
    restoreProjectFiles(c, snap, [blocksDir(c)]);
    expect((await loadComposedBlocks(c)).specs.map((s) => s.spec.name)).toEqual(['ProductCard']);
    expect(fs.existsSync(path.join(root, 'src/blocks/alpha'))).toBe(false);
  });
});

describe('composed block files: layout and overlay blocks', () => {
  const layoutSpec = (): ComposedBlockSpec => ({
    id: 'blk_layout01',
    name: 'SiteFrame',
    label: { 'en-US': 'Site frame' },
    category: 'Layout',
    version: 1,
    fields: {},
    tree: {
      el: 'Stack',
      children: [
        { el: 'Region', props: { name: 'header', label: { 'en-US': 'Header', 'vi-VN': 'Đầu trang' }, allow: ['StoreHeader'] } },
        { el: 'Box', props: { anchorId: 'main' }, children: [{ el: 'PageContent' }] },
        { el: 'Region', props: { name: 'footer' } },
      ],
    },
  });
  const overlaySpec = (): ComposedBlockSpec => ({
    id: 'blk_overlay01',
    name: 'LienHe',
    label: { 'en-US': 'Contact' },
    category: 'Overlay',
    version: 1,
    fields: { title: { kind: 'text', default: 'Contact us' } },
    tree: {
      el: 'Overlay',
      props: { variant: 'drawer', side: 'right', size: 'lg', closeOnBackdrop: false, showClose: true, labelledBy: 'first-heading' },
      style: { padding: { t: '8' }, background: 'brand:surface' },
      children: [
        { el: 'Heading', bind: { text: { from: 'field', name: 'title' } } },
        { el: 'Button', props: { label: 'Close', action: { type: 'overlay', op: 'close' } } },
        { el: 'Button', props: { label: 'Go', action: { type: 'scroll', target: 'main' }, variant: 'link' } },
      ],
    },
  });

  it('print -> load -> print is byte-identical', async () => {
    for (const s of [layoutSpec(), overlaySpec()]) {
      const root = tmp();
      const text = printComposedBlockFile(s);
      project(root, { 'x/x.block.ts': text });
      const { specs, errors } = await loadComposedBlocks(cfg(root));
      expect(errors).toEqual([]);
      expect(specs[0].spec).toEqual(s);
      expect(printComposedBlockFile(specs[0].spec)).toBe(text);
    }
  });

  it('prints Overlay, Region and action props in a fixed order', () => {
    const text = printComposedBlockFile(overlaySpec());
    const shuffled = overlaySpec();
    shuffled.tree.props = { labelledBy: 'first-heading', showClose: true, size: 'lg', closeOnBackdrop: false, side: 'right', variant: 'drawer' };
    shuffled.tree.children![1].props = { action: { op: 'close', type: 'overlay' }, label: 'Close' };
    shuffled.tree.children![2].props = { action: { target: 'main', type: 'scroll' }, label: 'Go', variant: 'link' };
    expect(printComposedBlockFile(shuffled)).toBe(text);
    expect(text).toContain("variant: 'drawer',\n      side: 'right',\n      size: 'lg',\n      closeOnBackdrop: false,\n      showClose: true,\n      labelledBy: 'first-heading',\n");
    expect(text).toContain("props: { label: 'Close', action: { type: 'overlay', op: 'close' } }");
    expect(text).toContain("props: { label: 'Go', variant: 'link', action: { type: 'scroll', target: 'main' } }");
    const l = layoutSpec();
    l.tree.children![0].props = { allow: ['StoreHeader'], label: { 'en-US': 'Header', 'vi-VN': 'Đầu trang' }, name: 'header' };
    expect(printComposedBlockFile(l)).toBe(printComposedBlockFile(layoutSpec()));
    // Specs without the new props print as before (insertion order of other props kept).
    const plain = spec();
    expect(printComposedBlockFile(plain)).toContain("props: { padding: 'md' }");
  });
});
