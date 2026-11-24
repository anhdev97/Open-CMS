'use client';

// The project theme in the builders: brand colours of the colour fields and the palette previewed in the canvas.
// The palette select changes only the canvas (the active palette is set on the Theme screen).
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { ThemeStyle } from '@opencloudcms/core/blocks';
import { isColorValue, type ThemeDefinition } from '@opencloudcms/schema';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { t } from '../../i18n';
import { api } from '../../lib/api';

export interface ThemeModel {
  /** The project theme; null when the project has none (or it could not be loaded). */
  theme: ThemeDefinition | null;
  /** Palette drawn in the canvas (the theme's active palette until changed). */
  palette: string;
  setPalette(p: string): void;
}

export const ThemeContext = createContext<ThemeModel>({ theme: null, palette: '', setPalette: () => {} });

export const useTheme = () => useContext(ThemeContext);

/** `GET /api/admin/theme`; null when there is none or it fails (the theme only adds swatches and canvas colours). */
export function loadTheme(): Promise<ThemeDefinition | null> {
  return api<{ theme: ThemeDefinition | null }>('/api/admin/theme').then(
    (r) => r.theme ?? null,
    () => null,
  );
}

export function ThemeProvider({ theme, children }: { theme: ThemeDefinition | null; children?: ReactNode }) {
  const [palette, setPalette] = useState(theme?.activePalette ?? '');
  const shown = theme && Object.prototype.hasOwnProperty.call(theme.palettes, palette) ? palette : (theme?.activePalette ?? '');
  const model = useMemo(() => ({ theme, palette: shown, setPalette }), [theme, shown]);
  return <ThemeContext.Provider value={model}>{children}</ThemeContext.Provider>;
}

/** `:root{--ocms-color-*}` of the previewed palette, inside the canvas iframe (null without a theme). */
export function CanvasTheme() {
  const { theme, palette } = useTheme();
  return theme ? <ThemeStyle theme={theme} palette={palette} /> : null;
}

/** Puck `overrides.iframe`: the canvas document with the theme's colour variables. */
export function CanvasFrame({ children }: { children?: ReactNode }) {
  return (
    <>
      <CanvasTheme />
      {children}
    </>
  );
}

/** Header select of the previewed palette; shown only when the theme has more than one. */
export function PaletteSelect() {
  const { theme, palette, setPalette } = useTheme();
  const ids = theme ? Object.keys(theme.palettes) : [];
  if (!theme || ids.length < 2) return null;
  return (
    <Select value={palette} onValueChange={setPalette}>
      <SelectTrigger size="sm" className="max-w-44" aria-label={t('blockBuilder.canvas.palette')} title={t('blockBuilder.canvas.paletteHint')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ids.map((id) => {
          const values = theme.palettes[id]?.values ?? {};
          return (
            <SelectItem key={id} value={id}>
              <span aria-hidden="true" className="flex">
                {Object.keys(theme.colors)
                  .slice(0, 4)
                  .map((c) => (
                    <span key={c} className="-ml-0.5 size-3 rounded-full border border-border first:ml-0" style={isColorValue(values[c]) ? { background: values[c] } : undefined} />
                  ))}
              </span>
              {theme.palettes[id]?.label || id}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
