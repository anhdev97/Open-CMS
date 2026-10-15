import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const dist = path.join(__dirname, '..', '..', 'dist');
const indexHtml = path.join(dist, 'admin', 'index.html');
const built = fs.existsSync(indexHtml);

describe.skipIf(!built)('admin SPA build output (run `pnpm --filter @opencms/core build` first)', () => {
  it('index.html has the root element and absolute /admin/assets/ URLs', () => {
    const html = fs.readFileSync(indexHtml, 'utf8');
    expect(html).toContain('<div id="root">');
    expect(html).toContain('src="/admin/assets/');
  });

  it('keeps the SPA output apart from server code', () => {
    expect(fs.existsSync(path.join(dist, 'http', 'admin-spa.middleware.js'))).toBe(true);
    expect(fs.existsSync(path.join(dist, 'admin', 'http'))).toBe(false);
  });

  it('ships the colour tokens of the design system in the built CSS', () => {
    const assets = path.join(dist, 'admin', 'assets');
    const css = fs
      .readdirSync(assets)
      .filter((f) => f.endsWith('.css'))
      .map((f) => fs.readFileSync(path.join(assets, f), 'utf8'))
      .join('\n')
      .toLowerCase();
    expect(css).toMatch(/--primary:\s*#2f5bea/);
    expect(css).toMatch(/--primary:\s*#7b9cff/);
  });
});

it.skipIf(built)('build output is missing: run `pnpm --filter @opencms/core build`', () => {
  expect(built).toBe(false);
});
