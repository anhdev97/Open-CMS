import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfig, type ComposedBlockSpec } from '@opencloudcms/schema';
import {
  blocksDir,
  captureProjectFiles,
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
