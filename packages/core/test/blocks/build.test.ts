import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const pkgRoot = path.join(__dirname, '..', '..');
const esm = path.join(pkgRoot, 'dist', 'blocks');
const cjs = path.join(pkgRoot, 'dist', 'blocks-cjs');
const built = fs.existsSync(path.join(esm, 'index.js')) && fs.existsSync(path.join(cjs, 'index.js'));

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

describe.skipIf(!built)('blocks output (run `pnpm --filter @opencloudcms/core build` first)', () => {
  it('emits ESM with declarations and no client directive or Nest import', () => {
    expect(fs.existsSync(path.join(esm, 'index.d.ts'))).toBe(true);
    const index = fs.readFileSync(path.join(esm, 'index.js'), 'utf8');
    expect(index.split('\n')[0]).not.toMatch(/use client/);
    expect(index).toMatch(/^export /m);
    for (const f of walk(esm).filter((p) => p.endsWith('.js'))) {
      const text = fs.readFileSync(f, 'utf8');
      expect(text, f).not.toContain('@nestjs');
      expect(text, f).not.toMatch(/from ['"]node:/);
    }
    for (const dir of [esm, cjs]) expect(fs.existsSync(path.join(dir, 'package.json'))).toBe(false);
  });

  it('emits CommonJS without Nest imports', () => {
    for (const f of walk(cjs).filter((p) => p.endsWith('.js'))) {
      const text = fs.readFileSync(f, 'utf8');
      expect(text, f).not.toContain('@nestjs');
      expect(text, f).not.toMatch(/^export /m);
    }
  });

  it('exposes ./blocks with import, require and types conditions', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));
    expect(pkg.exports['./blocks']).toEqual({
      types: './dist/blocks/index.d.ts',
      import: './dist/blocks/index.js',
      require: './dist/blocks-cjs/index.js',
    });
    expect(pkg.exports['.'].default).toBe('./dist/index.js');
  });

  it('can be required from Node and runs defineBlocks / blockManifest under CJS', () => {
    const script = `
      const blocks = require('@opencloudcms/core/blocks');
      const r = blocks.defineBlocks([
        blocks.defineBlock({ name: 'Hero', label: 'Hero', category: 'marketing', version: 2, fields: { t: blocks.b.text() }, render: () => null }),
      ]);
      process.stdout.write(JSON.stringify({ m: blocks.blockManifest(r), v: blocks.PUCK_FORMAT_VERSION, file: require.resolve('@opencloudcms/core/blocks') }));
    `;
    const out = JSON.parse(execFileSync(process.execPath, ['-e', script], { cwd: pkgRoot, encoding: 'utf8' }));
    expect(out.m).toEqual([{ name: 'Hero', version: 2 }]);
    expect(out.v).toBe(24);
    expect(out.file).toBe(path.join(cjs, 'index.js'));
  });
});

it.skipIf(built)('blocks build output is missing: run `pnpm --filter @opencloudcms/core build`', () => {
  expect(built).toBe(false);
});
