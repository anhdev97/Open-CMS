import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const pkgRoot = path.join(__dirname, '..', '..');
const adminDist = path.join(pkgRoot, 'dist', 'admin');
const built = fs.existsSync(path.join(adminDist, 'index.js'));

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

describe.skipIf(!built)('admin module output (run `pnpm --filter @opencloudcms/core build` first)', () => {
  it('emits index.js, layout.js and declarations', () => {
    expect(fs.existsSync(path.join(adminDist, 'index.js'))).toBe(true);
    expect(fs.existsSync(path.join(adminDist, 'layout.js'))).toBe(true);
    expect(fs.existsSync(path.join(adminDist, 'index.d.ts'))).toBe(true);
  });

  it('keeps the client directive on index.js and off layout.js', () => {
    expect(fs.readFileSync(path.join(adminDist, 'index.js'), 'utf8')).toMatch(/^\s*(["'])use client\1/);
    expect(fs.readFileSync(path.join(adminDist, 'layout.js'), 'utf8')).not.toContain('use client');
  });

  it('ships the colour tokens of the design system in theme.css', () => {
    const css = fs.readFileSync(path.join(adminDist, 'styles', 'theme.css'), 'utf8').toLowerCase();
    const rule = (selector: string) => css.match(new RegExp(`(?:^|[},\\s])${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
    expect(rule(':root')).toMatch(/--primary:\s*#2f5bea/);
    expect(rule('\\.dark')).toMatch(/--primary:\s*#7b9cff/);
  });

  it('is not an ESM package and has no leftovers of the SPA', () => {
    expect(fs.existsSync(path.join(adminDist, 'package.json'))).toBe(false);
    for (const f of walk(adminDist).filter((p) => /\.(js|ts|css)$/.test(p))) {
      const text = fs.readFileSync(f, 'utf8');
      expect(text, f).not.toContain(['react', 'router'].join('-'));
      expect(text, f).not.toContain('from "@/');
    }
  });

  it('exposes the admin entries through package exports', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));
    expect(Object.keys(pkg.exports)).toEqual(
      expect.arrayContaining(['.', './admin', './admin/layout', './admin/theme.css']),
    );
  });
});

it.skipIf(built)('build output is missing: run `pnpm --filter @opencloudcms/core build`', () => {
  expect(built).toBe(false);
});
