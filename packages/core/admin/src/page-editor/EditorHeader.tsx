import { ArrowLeftIcon, ExternalLinkIcon, Redo2Icon, TriangleAlertIcon, Undo2Icon } from 'lucide-react';
import { createContext, useContext, useEffect, useMemo } from 'react';
import { createUsePuck, useGetPuck } from '@puckeditor/core';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { t } from '../i18n';
import { isShadowedPath, pageHidesDetail } from '../lib/pages';
import { DeviceToggle } from '../block-builder/style/DeviceToggle';
import { PaletteSelect } from '../block-builder/style/theme-context';
import { baseOverlayEntries, overlayNameEntries } from '../block-builder/ActionField';
import type { AutosaveState } from './autosave';
import { OverlayWarning, overlayNameIssues } from './base-fields';
import { BaseContext } from './editor-context';

const usePuck = createUsePuck();

export interface HeaderModel {
  /** `base`: a base page (no path; publishing asks first). `detail`: a content type's detail template (no path). */
  kind: 'page' | 'base' | 'detail';
  /** Detail templates: the type's URL pattern and the "Preview entry" select (spec §3). */
  detail?: {
    apiId: string;
    pattern: string | null;
    entries: readonly { id: string; label: string }[];
    entryId: string | null;
    onEntry(id: string): void;
  } | null;
  /** Usable detail pages by apiId: a page whose path matches one hides that entry's detail URL (warning). */
  detailPaths?: Record<string, { path: string; slugField?: string }>;
  locale: string;
  locales: readonly string[];
  saveState: AutosaveState;
  /** Shown next to the save state when it is `error`. */
  saveError: string | null;
  readOnly: boolean;
  /** Paths a file route of the website serves first (`GET /api/admin/pages/shadowed`): warn when the page uses one. */
  shadowedPaths: readonly string[];
  canPublish: boolean;
  publishing: boolean;
  onBack(): void;
  onLocaleChange(locale: string): void;
  onSave(): void;
  onPublish(): void;
  onViewOnWebsite(): void;
  /** Receives Puck's state getter (used outside Puck's tree, e.g. to undo an invalid drop). */
  onPuck(get: ReturnType<typeof useGetPuck>): void;
}

export const HeaderContext = createContext<HeaderModel | null>(null);

const STATE_TONE: Record<AutosaveState, string> = {
  idle: 'text-muted-foreground',
  dirty: 'text-muted-foreground',
  saving: 'text-muted-foreground',
  saved: 'text-success',
  conflict: 'text-destructive',
  error: 'text-destructive',
};

/** Editor top bar (Puck `overrides.header`): back, title + path, locale, device, palette preview, undo/redo, website preview, save state, Save, Publish. */
export function EditorHeader() {
  const m = useContext(HeaderContext)!;
  const getPuck = useGetPuck();
  const title = usePuck((s) => (s.appState.data.root?.props as { title?: string } | undefined)?.title);
  const path = usePuck((s) => (s.appState.data.root?.props as { path?: string } | undefined)?.path);
  const hasPast = usePuck((s) => s.history.hasPast);
  const hasFuture = usePuck((s) => s.history.hasFuture);
  const back = usePuck((s) => s.history.back);
  const hidden = m.kind === 'page' && m.detailPaths ? pageHidesDetail(m.detailPaths, path) : null;
  const forward = usePuck((s) => s.history.forward);
  const { onPuck } = m;
  useEffect(() => onPuck(getPuck), [onPuck, getPuck]);
  // Overlay names of the page and of its base page's shown regions: duplicates and invalid names are flagged.
  const base = useContext(BaseContext);
  const data = usePuck((s) => s.appState.data);
  const overlayIssues = useMemo(() => {
    if (!base.registry) return null;
    return overlayNameIssues(overlayNameEntries(data, base.registry), baseOverlayEntries(base, data.root?.props as Record<string, unknown> | undefined));
  }, [data, base]);

  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2 text-card-foreground">
      <Button variant="ghost" size="sm" onClick={m.onBack} aria-label={t(m.kind === 'base' ? 'pageEditor.backBasesAria' : 'pageEditor.backAria')}>
        <ArrowLeftIcon aria-hidden="true" />
        {t(m.kind === 'base' ? 'pageEditor.backBases' : 'pageEditor.back')}
      </Button>
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <h1 className="truncate text-sm font-semibold">{title || t('content.untitled')}</h1>
        {m.kind === 'base' ? (
          <span className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground">{t('pageEditor.base.badge')}</span>
        ) : m.kind === 'detail' ? (
          <>
            <span className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground">{t('pageEditor.detail.badge')}</span>
            <span className="truncate font-mono text-xs text-muted-foreground">{m.detail?.pattern ?? t('pageEditor.detail.noPattern')}</span>
          </>
        ) : (
          <span className="truncate font-mono text-xs text-muted-foreground">{path}</span>
        )}
        {m.kind === 'page' && hidden && (
          <span role="status" className="inline-flex min-w-0 items-center gap-1 self-center text-xs text-warning">
            <TriangleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">{t('pageEditor.hidesDetail', { pattern: hidden.pattern, value: hidden.value })}</span>
          </span>
        )}
        {m.kind === 'page' && isShadowedPath(path, m.shadowedPaths) && (
          <span role="status" className="inline-flex min-w-0 items-center gap-1 self-center text-xs text-warning">
            <TriangleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">{t('pageEditor.shadowed', { path: path ?? '' })}</span>
          </span>
        )}
      </div>
      {m.detail && m.detail.entries.length > 0 && (
        <Select value={m.detail.entryId ?? undefined} onValueChange={m.detail.onEntry}>
          <SelectTrigger size="sm" className="max-w-48" aria-label={t('pageEditor.detail.previewEntry')} title={t('pageEditor.detail.previewEntry')}>
            <SelectValue placeholder={t('pageEditor.detail.previewEntry')} />
          </SelectTrigger>
          <SelectContent>
            {m.detail.entries.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {m.detail && m.detail.entries.length === 0 && <span className="text-xs text-muted-foreground">{t('pageEditor.detail.noEntries')}</span>}
      <Select value={m.locale} onValueChange={m.onLocaleChange}>
        <SelectTrigger size="sm" aria-label={t('pageEditor.localeLabel')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {m.locales.map((l) => (
            <SelectItem key={l} value={l}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <DeviceToggle />
      <PaletteSelect />
      {!m.readOnly && (
        <div className="flex items-center">
          <Button variant="ghost" size="icon-sm" disabled={!hasPast} onClick={back} aria-label={t('pageEditor.undo')}>
            <Undo2Icon aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="icon-sm" disabled={!hasFuture} onClick={forward} aria-label={t('pageEditor.redo')}>
            <Redo2Icon aria-hidden="true" />
          </Button>
        </div>
      )}
      <Button variant="outline" size="sm" onClick={m.onViewOnWebsite}>
        <ExternalLinkIcon aria-hidden="true" />
        {t('pageEditor.viewOnWebsite')}
      </Button>
      {!m.readOnly && (
        <>
          <span role="status" aria-live="polite" className={`text-xs ${STATE_TONE[m.saveState]}`} title={m.saveError ?? undefined}>
            {t(`pageEditor.saveState.${m.saveState}`)}
            {m.saveState === 'error' && m.saveError ? `: ${m.saveError}` : ''}
          </span>
          <Button variant="outline" size="sm" onClick={m.onSave} disabled={m.saveState === 'saving' || m.saveState === 'conflict'}>
            {t('pageEditor.save')}
          </Button>
        </>
      )}
      {m.canPublish && (
        <Button size="sm" onClick={m.onPublish} disabled={m.publishing || m.saveState === 'conflict'}>
          {m.publishing ? t('pageEditor.publishing') : t('pageEditor.publish')}
        </Button>
      )}
      <OverlayWarning issues={overlayIssues} />
    </header>
  );
}
