import type { ReactElement } from 'react';
import { isColorValue, validateTheme, type ThemeDefinition } from '@opencloudcms/schema';

const NAME_RE = /^[a-z][a-z0-9-]{0,31}$/;
let warned = false;

/**
 * `:root{--ocms-color-<name>:<hex>;…}` for a palette of `theme` (default: its `activePalette`; an unknown `palette`
 * falls back to it). Server-safe (no hooks). Only names and hex values that pass validation are written.
 */
export function ThemeStyle({ theme, palette }: { theme: ThemeDefinition; palette?: string }): ReactElement | null {
  const issues = validateTheme(theme);
  if (issues.length) {
    if (!warned) {
      warned = true;
      console.warn(`[opencloudcms] ThemeStyle skipped an invalid theme: ${issues[0].path.join('.')}: ${issues[0].message}`);
    }
    return null;
  }
  const id = palette !== undefined && Object.prototype.hasOwnProperty.call(theme.palettes, palette) ? palette : theme.activePalette;
  const decls = Object.entries(theme.palettes[id]?.values ?? {})
    .filter(([name, v]) => NAME_RE.test(name) && isColorValue(v) && typeof v === 'string' && v.startsWith('#'))
    .map(([name, v]) => `--ocms-color-${name}:${v}`);
  return <style>{`:root{${decls.join(';')}}`}</style>;
}
