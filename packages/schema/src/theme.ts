// Pure brand theme (named colors with switchable palettes). No `node:*` imports.
import type { ComposedIssue } from './composed-block';

export interface ThemeDefinition {
  colors: Record<string, { label?: string }>;
  palettes: Record<string, { label?: string; values: Record<string, string> }>;
  activePalette: string;
}

const NAME_RE = /^[a-z][a-z0-9-]{0,31}$/;
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function defineTheme(t: ThemeDefinition): ThemeDefinition {
  return t;
}

export function validateTheme(t: unknown): ComposedIssue[] {
  const issues: ComposedIssue[] = [];
  const add = (path: (string | number)[], message: string) => issues.push({ path, message });
  if (!isObj(t)) return [{ path: [], message: 'Theme must be an object' }];
  const colors = isObj(t.colors) ? t.colors : undefined;
  if (!colors) add(['colors'], 'colors must be an object');
  else for (const [name, c] of Object.entries(colors)) {
    if (!NAME_RE.test(name)) add(['colors', name], 'color name must match ^[a-z][a-z0-9-]{0,31}$');
    if (!isObj(c)) add(['colors', name], 'color must be an object');
    else if (c.label !== undefined && typeof c.label !== 'string') add(['colors', name, 'label'], 'label must be a string');
  }
  const palettes = isObj(t.palettes) ? t.palettes : undefined;
  if (!palettes) add(['palettes'], 'palettes must be an object');
  else for (const [id, p] of Object.entries(palettes)) {
    if (!NAME_RE.test(id)) add(['palettes', id], 'palette id must match ^[a-z][a-z0-9-]{0,31}$');
    if (!isObj(p) || !isObj(p.values)) { add(['palettes', id, 'values'], 'palette requires a values object'); continue; }
    if (p.label !== undefined && typeof p.label !== 'string') add(['palettes', id, 'label'], 'label must be a string');
    const values = p.values;
    for (const name of Object.keys(colors ?? {})) {
      if (!own(values, name)) add(['palettes', id, 'values', name], `missing a value for color "${name}"`);
    }
    for (const [name, v] of Object.entries(values)) {
      if (colors && !own(colors, name)) add(['palettes', id, 'values', name], `unknown color "${name}"`);
      else if (typeof v !== 'string' || !HEX_RE.test(v)) add(['palettes', id, 'values', name], 'must be a hex color (#rgb, #rrggbb or #rrggbbaa)');
    }
  }
  if (typeof t.activePalette !== 'string' || !palettes || !own(palettes, t.activePalette)) {
    add(['activePalette'], 'activePalette must name an existing palette');
  }
  return issues;
}

/** Color name → hex of the active palette. */
export function activeColors(t: ThemeDefinition): Record<string, string> {
  return { ...(t.palettes[t.activePalette]?.values ?? {}) };
}
