import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfig, type ThemeDefinition } from '@opencloudcms/schema';
import { loadTheme, printThemeFile, themeFile } from '../src';

const theme: ThemeDefinition = {
  colors: { primary: { label: "Brand's primary" }, 'on-dark': {} },
  palettes: {
    olive: { label: 'Olive', values: { primary: '#556b2f', 'on-dark': '#fff' } },
    sand: { values: { primary: '#c2b280', 'on-dark': '#000000' } },
  },
  activePalette: 'olive',
};

describe('theme file', () => {
  it('prints a file that loads back deep-equal', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-theme-'));
    const config = resolveConfig({ database: { url: 'postgres://x' } } as any, root);
    expect(await loadTheme(config)).toBeNull();
    fs.mkdirSync(path.join(root, 'src'));
    const text = printThemeFile(theme);
    expect(text).toContain('Managed by OpenCloudCMS');
    expect(text).toContain("import { defineTheme } from '@opencloudcms/schema';");
    expect(text.indexOf('colors:')).toBeLessThan(text.indexOf('palettes:'));
    expect(text.indexOf('palettes:')).toBeLessThan(text.indexOf('activePalette:'));
    fs.writeFileSync(themeFile(config), text);
    expect(await loadTheme(config)).toEqual(theme);
  });

  it('throws with the issue list for an invalid file', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-theme-'));
    const config = resolveConfig({ database: { url: 'postgres://x' } } as any, root);
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(themeFile(config), "export default { colors: {}, palettes: {}, activePalette: 'x' };\n");
    await expect(loadTheme(config)).rejects.toThrow(/activePalette/);
  });
});
