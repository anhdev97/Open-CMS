'use client';

// Icon picker (spec §3 "Prop fields"): a search box over `ICON_NAMES` and a grid of the icons the website can draw.
// Matching is case- and accent-insensitive on the name. Optional icons (Button) have a "No icon" choice.
import { useContext, useId, useMemo, useState } from 'react';
import type { CustomFieldRender } from '@puckeditor/core';
import { ui } from '@opencloudcms/core/blocks';
import { ICON_NAMES, foldSearch } from '@opencloudcms/schema';
import { Input } from '../components/ui/input';
import { t } from '../i18n';
import { FieldShell, fieldLabel } from '../page-editor/FieldShell';
import { BuilderContext } from './context';

/** Icon names matching `query` (every name for an empty query). */
export function filterIcons(query: string): string[] {
  const q = foldSearch(query.trim());
  return q ? ICON_NAMES.filter((n) => foldSearch(n).includes(q)) : [...ICON_NAMES];
}

export interface IconPickerProps {
  id: string;
  label: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  /** A "No icon" choice (writes `undefined`). */
  optional?: boolean;
  readOnly?: boolean;
}

const TILE =
  'inline-flex size-8 items-center justify-center rounded-md border border-transparent text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-primary aria-pressed:bg-primary/10 disabled:opacity-50';

export function IconPicker({ id, label, value, onChange, optional, readOnly }: IconPickerProps) {
  const [query, setQuery] = useState('');
  const listId = useId();
  const shown = useMemo(() => filterIcons(query), [query]);
  return (
    <FieldShell id={id} label={label}>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border" aria-hidden="true">
            {value ? <ui.Icon name={value} size="sm" /> : null}
          </span>
          <Input
            id={id}
            type="search"
            className="h-8"
            placeholder={t('blockBuilder.iconPicker.search')}
            aria-label={t('blockBuilder.iconPicker.search')}
            aria-controls={listId}
            value={query}
            disabled={readOnly}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {optional && (
          <button type="button" data-icon-none aria-pressed={!value} disabled={readOnly} className="text-xs text-muted-foreground underline-offset-2 hover:underline aria-pressed:font-medium aria-pressed:text-foreground" onClick={() => onChange(undefined)}>
            {t('blockBuilder.iconPicker.none')}
          </button>
        )}
        <div id={listId} role="group" aria-label={label} className="grid max-h-48 grid-cols-7 gap-1 overflow-y-auto">
          {shown.map((name) => (
            <button key={name} type="button" data-icon={name} title={name} aria-label={name} aria-pressed={value === name} disabled={readOnly} className={TILE} onClick={() => onChange(name)}>
              <ui.Icon name={name} size="sm" />
            </button>
          ))}
        </div>
        {shown.length === 0 && <p className="text-xs text-muted-foreground">{t('blockBuilder.iconPicker.noMatches')}</p>}
      </div>
    </FieldShell>
  );
}

/** Puck custom field of an icon prop (`metadata.optional`). */
export const IconField: CustomFieldRender<unknown> = ({ field, name, id, value, onChange, readOnly }) => {
  const m = useContext(BuilderContext);
  const optional = ((field.metadata ?? {}) as { optional?: boolean }).optional === true;
  return (
    <IconPicker
      id={id}
      label={fieldLabel(field, name)}
      value={typeof value === 'string' && value ? value : undefined}
      onChange={onChange}
      optional={optional}
      readOnly={readOnly || m?.readOnly}
    />
  );
};
