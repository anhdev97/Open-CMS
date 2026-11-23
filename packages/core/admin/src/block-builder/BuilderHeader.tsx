// Top bar of the block builder (Puck `overrides.header`): back, label + name, content type and mode, sample entry,
// content locale, undo/redo, Save.
import { ArrowLeftIcon, Redo2Icon, Undo2Icon } from 'lucide-react';
import { createContext, useContext, useEffect } from 'react';
import { createUsePuck, useGetPuck } from '@puckeditor/core';
import { localizedText, type Locale } from '@opencloudcms/schema';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { getActiveLocale, t } from '../i18n';
import type { ContentTypeDefinition } from '../lib/types';

const usePuck = createUsePuck();

export interface BuilderHeaderModel {
  title: string;
  name: string;
  readOnly: boolean;
  dirty: boolean;
  saving: boolean;
  types: readonly ContentTypeDefinition[];
  apiId: string | null;
  mode: 'single' | 'collection';
  /** Single mode: entries to preview with, and the one shown. */
  samples: { id: string; label: string }[];
  sampleId: string | null;
  locale: string;
  locales: readonly string[];
  onBack(): void;
  onType(apiId: string | null): void;
  onMode(mode: 'single' | 'collection'): void;
  onSample(id: string): void;
  onLocale(locale: string): void;
  onSave(): void;
  onPuck(get: ReturnType<typeof useGetPuck>): void;
}

export const BuilderHeaderContext = createContext<BuilderHeaderModel | null>(null);

const NONE = '__none';

export function BuilderHeader() {
  const m = useContext(BuilderHeaderContext)!;
  const getPuck = useGetPuck();
  const hasPast = usePuck((s) => s.history.hasPast);
  const hasFuture = usePuck((s) => s.history.hasFuture);
  const back = usePuck((s) => s.history.back);
  const forward = usePuck((s) => s.history.forward);
  const { onPuck } = m;
  useEffect(() => onPuck(getPuck), [onPuck, getPuck]);
  const ui = getActiveLocale() as Locale;

  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2 text-card-foreground">
      <Button variant="ghost" size="sm" onClick={m.onBack} aria-label={t('blockBuilder.backAria')}>
        <ArrowLeftIcon aria-hidden="true" />
        {t('blockBuilder.back')}
      </Button>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <h1 className="truncate text-sm font-semibold">{m.title || t('blockBuilder.untitled')}</h1>
        {m.name && <span className="truncate font-mono text-xs text-muted-foreground">{m.name}</span>}
        {m.dirty && !m.readOnly && <Badge variant="warning">{t('blockBuilder.unsaved')}</Badge>}
      </div>
      <Select value={m.apiId ?? NONE} disabled={m.readOnly} onValueChange={(v) => m.onType(v === NONE ? null : v)}>
        <SelectTrigger size="sm" aria-label={t('blockBuilder.contentType')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t('blockBuilder.noContentType')}</SelectItem>
          {m.types.map((ct) => (
            <SelectItem key={ct.apiId} value={ct.apiId}>
              {t('blockBuilder.contentTypeOption', { type: localizedText(ct.displayName as never, ui, ct.apiId) })}
            </SelectItem>
          ))}
          {m.apiId && !m.types.some((ct) => ct.apiId === m.apiId) && (
            <SelectItem value={m.apiId} disabled>
              {m.apiId}
            </SelectItem>
          )}
        </SelectContent>
      </Select>
      {m.apiId && (
        <div role="group" aria-label={t('blockBuilder.mode.label')} className="inline-flex rounded-md border border-border p-0.5">
          {(['single', 'collection'] as const).map((mode) => (
            <Button key={mode} type="button" size="sm" className="h-7" variant={m.mode === mode ? 'secondary' : 'ghost'} aria-pressed={m.mode === mode} disabled={m.readOnly} onClick={() => m.onMode(mode)}>
              {t(`blockBuilder.mode.${mode}`)}
            </Button>
          ))}
        </div>
      )}
      {m.apiId && m.mode === 'single' && m.samples.length > 0 && (
        <Select value={m.sampleId ?? undefined} onValueChange={m.onSample}>
          <SelectTrigger size="sm" className="max-w-48" aria-label={t('blockBuilder.sampleEntry')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {m.samples.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Select value={m.locale} onValueChange={m.onLocale}>
        <SelectTrigger size="sm" aria-label={t('blockBuilder.previewLocale')}>
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
      {!m.readOnly && (
        <Button size="sm" onClick={m.onSave} disabled={m.saving}>
          {m.saving ? t('blockBuilder.saving') : t('blockBuilder.save')}
        </Button>
      )}
    </header>
  );
}
