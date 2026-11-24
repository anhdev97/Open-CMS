import type { ThemeDefinition } from '@opencloudcms/schema';
import { api } from './api';

export interface ThemeResponse {
  theme: ThemeDefinition | null;
  editable: boolean;
}

export const fetchTheme = () => api<ThemeResponse>('/api/admin/theme');
export const saveTheme = (theme: ThemeDefinition) => api<ThemeResponse>('/api/admin/theme', { method: 'PUT', json: theme });

/** The minimal valid theme the "Create theme" empty state starts from. */
export const SEED_THEME: ThemeDefinition = {
  colors: { primary: {} },
  palettes: { default: { values: { primary: '#000000' } } },
  activePalette: 'default',
};

const rekey = <V>(o: Record<string, V>, from: string, to: string): Record<string, V> =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k === from ? to : k, v]));

export function renameColor(t: ThemeDefinition, from: string, to: string): ThemeDefinition {
  if (from === to) return t;
  return {
    ...t,
    colors: rekey(t.colors, from, to),
    palettes: Object.fromEntries(Object.entries(t.palettes).map(([id, p]) => [id, { ...p, values: rekey(p.values, from, to) }])),
  };
}

export function removeColor(t: ThemeDefinition, name: string): ThemeDefinition {
  const { [name]: _c, ...colors } = t.colors;
  return {
    ...t,
    colors,
    palettes: Object.fromEntries(
      Object.entries(t.palettes).map(([id, p]) => {
        const { [name]: _v, ...values } = p.values;
        return [id, { ...p, values }];
      }),
    ),
  };
}

export function addColor(t: ThemeDefinition, name: string): ThemeDefinition {
  return {
    ...t,
    colors: { ...t.colors, [name]: {} },
    palettes: Object.fromEntries(Object.entries(t.palettes).map(([id, p]) => [id, { ...p, values: { ...p.values, [name]: '#000000' } }])),
  };
}

/** New palette seeded with the active palette's values. */
export function addPalette(t: ThemeDefinition, id: string): ThemeDefinition {
  const src = t.palettes[t.activePalette]?.values ?? {};
  return { ...t, palettes: { ...t.palettes, [id]: { values: { ...src } } } };
}

export function renamePalette(t: ThemeDefinition, from: string, to: string): ThemeDefinition {
  if (from === to) return t;
  return { ...t, palettes: rekey(t.palettes, from, to), activePalette: t.activePalette === from ? to : t.activePalette };
}

export function removePalette(t: ThemeDefinition, id: string): ThemeDefinition {
  const { [id]: _p, ...palettes } = t.palettes;
  const activePalette = t.activePalette === id ? (Object.keys(palettes)[0] ?? '') : t.activePalette;
  return { ...t, palettes, activePalette };
}

export function setValue(t: ThemeDefinition, palette: string, color: string, value: string): ThemeDefinition {
  const p = t.palettes[palette];
  if (!p) return t;
  return { ...t, palettes: { ...t.palettes, [palette]: { ...p, values: { ...p.values, [color]: value } } } };
}

export const isHex = (v: string) => /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v);
export const isThemeName = (v: string) => /^[a-z][a-z0-9-]{0,31}$/.test(v);

/** First unused `${base}-N` id. */
export function uniqueName(base: string, taken: readonly string[]): string {
  for (let n = 2; ; n++) if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`;
}
