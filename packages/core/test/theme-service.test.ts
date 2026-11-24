import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveConfig } from '@opencloudcms/schema';
import { ThemeService } from '../src/theme';

const mk = (v: string) => ({ colors: { a: {} }, palettes: { p: { values: { a: v } } }, activePalette: 'p' });

function service() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-theme-svc-'));
  const config = resolveConfig({ database: { url: 'postgres://x' } } as any, root);
  const queue = { run: (fn: () => Promise<unknown>) => fn() };
  const builder = { assertEditable: () => undefined };
  const svc = new ThemeService({ config, schemaEditable: true } as any, builder as any, queue as any);
  return { svc, file: path.join(root, 'src', 'theme.ts') };
}

describe('ThemeService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    syncBuiltinESMExports();
  });

  it('restores the previous file bytes when the write throws', async () => {
    const { svc, file } = service();
    await svc.replace(mk('#111111'));
    const before = fs.readFileSync(file);
    const real = fs.writeFileSync;
    let first = true;
    vi.spyOn(fs, 'writeFileSync').mockImplementation(((f: any, d: any, o?: any) => {
      if (first) {
        first = false;
        real(f, 'garbage {', o);
        throw new Error('disk full');
      }
      return real(f, d, o);
    }) as any);
    syncBuiltinESMExports();
    await expect(svc.replace(mk('#222222'))).rejects.toThrow('disk full');
    expect(fs.readFileSync(file).equals(before)).toBe(true);
  });

  it('keeps the original error when the restore also fails', async () => {
    const { svc } = service();
    await svc.replace(mk('#111111'));
    vi.spyOn(fs, 'writeFileSync').mockImplementation((() => {
      throw new Error('first');
    }) as any);
    syncBuiltinESMExports();
    vi.spyOn(fs, 'rmSync').mockImplementation(() => {
      throw new Error('rm failed');
    });
    syncBuiltinESMExports();
    await expect(svc.replace(mk('#222222'))).rejects.toThrow('first');
  });
});
