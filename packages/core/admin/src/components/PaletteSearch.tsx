// Palette search (spec §3 "Palette search", Decision 8): a search box at the top of the Block builder palette
// (elements and templates) and of the Page builder block list. It filters Puck's drawer through `ui.componentList`
// (case- and accent-insensitive, translated label or English name), hides empty categories, shows "No matches",
// inserts the first match on Enter, is focused by `/` or Ctrl/Cmd+K outside text fields and cleared by Esc.
import { SearchIcon } from 'lucide-react';
import { createContext, createElement, useContext, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useGetPuck } from '@puckeditor/core';
import { foldSearch } from '@opencloudcms/schema';
import { t } from '../i18n';
import { Input } from './ui/input';

export type GetPuck = ReturnType<typeof useGetPuck>;
export type PaletteCategory = { title?: string; components?: string[]; visible?: boolean; expanded?: boolean };

export interface PaletteModel {
  /** The palette without a search (Puck categories, `visible: false` ones stay hidden). */
  categories: Record<string, PaletteCategory>;
  /** The label shown for a component and its English name (both searched). */
  describe(name: string): { label: string; english: string };
  /** Inserts component `name` (Enter on the first match). */
  insert(name: string, get: GetPuck): void;
  /** Accessible name of the search box. */
  label: string;
}

/** Where the filtered-out components go: a hidden category (Puck lists uncategorized components under "Other"). */
const UNMATCHED = '__unmatched';

/** The categories with only the components matching `query`, and the matches in palette order. */
export function filterPalette(
  categories: Record<string, PaletteCategory>,
  query: string,
  describe: PaletteModel['describe'],
): { categories: Record<string, PaletteCategory>; matches: string[] } {
  const q = foldSearch(query.trim());
  const matches: string[] = [];
  if (!q) {
    for (const c of Object.values(categories)) if (c.visible !== false) matches.push(...(c.components ?? []));
    return { categories, matches };
  }
  const out: Record<string, PaletteCategory> = {};
  const rest: string[] = [];
  for (const [key, c] of Object.entries(categories)) {
    if (c.visible === false || !c.components) {
      out[key] = c;
      continue;
    }
    const hit = c.components.filter((n) => {
      const d = describe(n);
      return foldSearch(d.label).includes(q) || foldSearch(d.english).includes(q) || foldSearch(n).includes(q);
    });
    rest.push(...c.components.filter((n) => !hit.includes(n)));
    matches.push(...hit);
    out[key] = { ...c, components: hit, visible: hit.length > 0 };
  }
  out[UNMATCHED] = { components: rest, visible: false };
  return { categories: out, matches };
}

/** Whether keys typed at `target` are text input (where `/` and Ctrl/Cmd+K must not be taken). */
export function isTextField(target: EventTarget | null): boolean {
  const el = target as Element | null;
  if (!el || typeof el.closest !== 'function') return false;
  if (el.closest('textarea, select, [contenteditable]:not([contenteditable="false"])')) return true;
  if ((el as HTMLElement).isContentEditable) return true;
  if (el.tagName === 'INPUT') {
    const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image'].includes(type);
  }
  return false;
}

let seq = 0;
/**
 * Dispatches a Puck insert of `componentType` at `target`, then selects the new item. `getPuck()` returns a state
 * snapshot (Puck 0.24.1): the selector is read from a fresh one taken after the insert.
 */
export function insertAndSelect(get: GetPuck, componentType: string, target: { zone: string; index: number }): string {
  const id = `${componentType}-${Date.now().toString(36)}${(++seq).toString(36)}`;
  get().dispatch({ type: 'insert', componentType, destinationZone: target.zone, destinationIndex: target.index, id } as never);
  const itemSelector = get().getSelectorForId(id);
  if (itemSelector) get().dispatch({ type: 'setUi', ui: { itemSelector } } as never);
  return id;
}

export function PaletteSearch({ categories, describe, insert, label }: PaletteModel) {
  const getPuck = useGetPuck();
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const filtered = useMemo(() => filterPalette(categories, query, describe), [categories, query, describe]);
  const searching = query.trim() !== '';
  // Expanded flags of the categories before the search (a search opens every category; clearing restores them).
  const saved = useRef<Record<string, boolean | undefined> | null>(null);

  useEffect(() => {
    const api = getPuck();
    const cur = (api.appState.ui.componentList ?? {}) as Record<string, PaletteCategory>;
    if (searching && !saved.current) saved.current = Object.fromEntries(Object.entries(cur).map(([k, c]) => [k, c.expanded]));
    const restore = !searching ? saved.current : null;
    if (!searching) saved.current = null;
    const componentList: Record<string, PaletteCategory> = {};
    for (const [k, c] of Object.entries(filtered.categories)) {
      const next: PaletteCategory = { ...(cur[k] ?? {}), ...c };
      if (searching) next.expanded = true;
      else if (restore && k in restore) next.expanded = restore[k];
      if (!searching && !('visible' in c)) delete next.visible;
      componentList[k] = next;
    }
    api.dispatch({ type: 'setUi', ui: { componentList } as never });
  }, [filtered]); // eslint-disable-line react-hooks/exhaustive-deps

  // `/` and Ctrl/Cmd+K focus the box from anywhere but a text field, also from the canvas iframe.
  useEffect(() => {
    const docs = new Set<Document>();
    const onKey = (e: globalThis.KeyboardEvent) => {
      const slash = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey;
      const k = (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k';
      if ((!slash && !k) || e.defaultPrevented || isTextField(e.target)) return;
      e.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    const attach = (d: Document | null | undefined) => {
      if (!d || docs.has(d)) return;
      docs.add(d);
      d.addEventListener('keydown', onKey);
    };
    const scan = () => {
      document.querySelectorAll('iframe').forEach((f) => {
        try {
          attach(f.contentDocument);
        } catch {
          // cross-origin frame
        }
      });
    };
    attach(document);
    scan();
    // Focus moving into the canvas iframe blurs the window: its document may be new (iframe reload).
    window.addEventListener('blur', scan);
    return () => {
      window.removeEventListener('blur', scan);
      for (const d of docs) d.removeEventListener('keydown', onKey);
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = searching ? filtered.matches[0] : undefined;
      if (!first) return;
      insert(first, getPuck);
      setQuery('');
    } else if (e.key === 'Escape') {
      if (!query) return;
      e.preventDefault();
      e.stopPropagation();
      setQuery('');
    }
  };

  return (
    <div data-palette-search="" className="space-y-1 border-b border-border p-2">
      <div className="relative">
        <SearchIcon aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={input}
          type="search"
          aria-label={label}
          aria-describedby={`${id}-hint`}
          placeholder={t('paletteSearch.placeholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          className="h-8 pl-8"
          autoComplete="off"
        />
      </div>
      <p id={`${id}-hint`} className="sr-only">
        {t('paletteSearch.hint')}
      </p>
      {searching && filtered.matches.length === 0 && (
        <p role="status" data-palette-empty="" className="px-1 py-2 text-sm text-muted-foreground">
          {t('paletteSearch.noMatches')}
        </p>
      )}
    </div>
  );
}

/** The palette of the builder in use (provided around Puck; read by `PaletteDrawer`). */
export const PaletteContext = createContext<PaletteModel | null>(null);

/** Puck `overrides.drawer`: the search box above the drawer. */
export function PaletteDrawer({ children }: { children?: ReactNode }) {
  const m = useContext(PaletteContext);
  return createElement('div', null, m ? createElement(PaletteSearch, m) : null, children);
}
