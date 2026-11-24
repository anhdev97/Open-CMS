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

  it('keeps the original error, with the restore failure as cause, when restoring an existing file fails', async () => {
    const { svc } = service();
    await svc.replace(mk('#111111'));
    vi.spyOn(fs, 'writeFileSync').mockImplementation(((_f: any, d: any) => {
      throw new Error(typeof d === 'string' ? 'first' : 'restore failed');
    }) as any);
    syncBuiltinESMExports();
    const err = await svc.replace(mk('#222222')).catch((e) => e);
    expect(err.message).toBe('first');
    expect(err.cause.message).toBe('restore failed');
  });

  it('removes the new file on failure when none existed before, and survives a failing rmSync', async () => {
    const a = service();
    const real = fs.writeFileSync;
    vi.spyOn(fs, 'writeFileSync').mockImplementation(((f: any, d: any, o?: any) => {
      real(f, 'garbage {', o);
      throw new Error('disk full');
    }) as any);
    syncBuiltinESMExports();
    await expect(a.svc.replace(mk('#222222'))).rejects.toThrow('disk full');
    expect(fs.existsSync(a.file)).toBe(false);

    const b = service();
    vi.spyOn(fs, 'rmSync').mockImplementation(() => {
      throw new Error('rm failed');
    });
    syncBuiltinESMExports();
    const err = await b.svc.replace(mk('#222222')).catch((e) => e);
    expect(err.message).toBe('disk full');
    expect(err.cause.message).toBe('rm failed');
  });
});
