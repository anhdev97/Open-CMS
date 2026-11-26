'use client';

// `options` of Select / Combobox / Radio (spec §1.1): an editable list of value / label rows with reorder. A row
// that breaks the rules (empty or duplicate value, empty label) shows its error inline and nothing is written until
// the list is valid again. A label localized in code is edited in the preview language only.
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useContext, useEffect, useRef, useState } from 'react';
import type { CustomFieldRender } from '@puckeditor/core';
import { MAX_OPTIONS, validateOptions, type ControlOption, type LocalizedText } from '@opencloudcms/schema';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { t } from '../i18n';
import { FieldShell, fieldLabel } from '../page-editor/FieldShell';
import { BuilderContext, CanvasContext } from './context';

type Row = ControlOption;
type RowErrors = { value?: string; label?: string };

const rowsOf = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]).map((o) => ({ ...o })) : []);
const labelText = (l: Row['label'], locale: string): string =>
  typeof l === 'string' ? l : ((l as Record<string, string | undefined>)?.[locale] ?? (l as Record<string, string | undefined>)?.['en-US'] ?? '');

/** Inline errors per row (index → field → message) from the schema's option rules. */
export function optionErrors(rows: readonly Row[]): RowErrors[] {
  const out: RowErrors[] = rows.map(() => ({}));
  for (const issue of validateOptions(rows, [])) {
    const [i, key] = issue.path as [number | undefined, string | undefined];
    if (typeof i !== 'number' || !out[i]) continue;
    if (key === 'value') {
      const dup = rows[i]!.value;
      out[i]!.value = issue.message.startsWith('duplicate') ? t('blockBuilder.options.duplicate', { value: dup }) : t('blockBuilder.options.emptyValue');
    } else if (key === 'label') out[i]!.label = t('blockBuilder.options.emptyLabel');
  }
  return out;
}

export interface OptionsEditorProps {
  id: string;
  label: string;
  value: unknown;
  onChange: (v: Row[]) => void;
  readOnly?: boolean;
  /** Locale edited in a localized label (the preview language). */
  locale?: string;
}

export function OptionsEditor({ id, label, value, onChange, readOnly, locale = 'en-US' }: OptionsEditorProps) {
  const [rows, setRows] = useState<Row[]>(() => rowsOf(value));
  const last = useRef(JSON.stringify(value ?? null));
  useEffect(() => {
    const json = JSON.stringify(value ?? null);
    if (json === last.current) return;
    last.current = json;
    setRows(rowsOf(value));
  }, [value]);

  const errors = optionErrors(rows);
  const write = (next: Row[]) => {
    setRows(next);
    if (validateOptions(next, []).length) return;
    last.current = JSON.stringify(next);
    onChange(next);
  };
  const setRow = (i: number, patch: Partial<Row>) => write(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const setLabel = (i: number, text: string) => {
    const l = rows[i]!.label;
    setRow(i, { label: typeof l === 'string' ? text : ({ ...l, [locale]: text } as LocalizedText) });
  };
  const move = (i: number, by: -1 | 1) => {
    const next = [...rows];
    [next[i], next[i + by]] = [next[i + by]!, next[i]!];
    write(next);
  };
  const add = () => {
    let n = rows.length + 1;
    const taken = new Set(rows.map((r) => r.value));
    while (taken.has(`option-${n}`)) n++;
    write([...rows, { value: `option-${n}`, label: t('blockBuilder.options.row', { n: rows.length + 1 }) }]);
  };

  return (
    <FieldShell id={id} as="legend" label={label}>
      <ol className="space-y-2">
        {rows.map((r, i) => {
          const e = errors[i] ?? {};
          const msgId = `${id}-row-${i}-msg`;
          return (
            <li key={i} data-row={i} className="space-y-1 rounded-md border border-border p-2" aria-label={t('blockBuilder.options.row', { n: i + 1 })}>
              <div className="flex items-center gap-1">
                <Input
                  data-value
                  aria-label={t('blockBuilder.options.value')}
                  placeholder={t('blockBuilder.options.value')}
                  className="h-8 min-w-0 flex-1 font-mono text-xs"
                  value={r.value}
                  disabled={readOnly}
                  aria-invalid={e.value ? true : undefined}
                  aria-describedby={msgId}
                  onChange={(ev) => setRow(i, { value: ev.target.value })}
                />
                <Input
                  data-label
                  aria-label={t('blockBuilder.options.label')}
                  placeholder={t('blockBuilder.options.label')}
                  className="h-8 min-w-0 flex-1 text-xs"
                  value={labelText(r.label, locale)}
                  disabled={readOnly}
                  aria-invalid={e.label ? true : undefined}
                  aria-describedby={msgId}
                  onChange={(ev) => setLabel(i, ev.target.value)}
                />
              </div>
              <div className="flex items-center justify-end gap-0.5">
                <Button type="button" data-move="up" variant="ghost" size="icon-sm" disabled={readOnly || i === 0} aria-label={t('blockBuilder.options.moveUp')} title={t('blockBuilder.options.moveUp')} onClick={() => move(i, -1)}>
                  <ArrowUpIcon aria-hidden="true" />
                </Button>
                <Button type="button" data-move="down" variant="ghost" size="icon-sm" disabled={readOnly || i === rows.length - 1} aria-label={t('blockBuilder.options.moveDown')} title={t('blockBuilder.options.moveDown')} onClick={() => move(i, 1)}>
                  <ArrowDownIcon aria-hidden="true" />
                </Button>
                <Button type="button" data-remove variant="ghost" size="icon-sm" disabled={readOnly || rows.length <= 1} aria-label={t('blockBuilder.options.remove')} title={t('blockBuilder.options.remove')} onClick={() => write(rows.filter((_, j) => j !== i))}>
                  <Trash2Icon aria-hidden="true" />
                </Button>
              </div>
              <div id={msgId}>
                {(e.value || e.label) && (
                  <p role="alert" className="text-xs text-destructive">
                    {e.value ?? e.label}
                  </p>
                )}
                {typeof r.label !== 'string' && <p className="text-xs text-muted-foreground">{t('blockBuilder.options.localized', { locale })}</p>}
              </div>
            </li>
          );
        })}
      </ol>
      <Button type="button" size="sm" variant="outline" disabled={readOnly || rows.length >= MAX_OPTIONS} onClick={add}>
        <PlusIcon aria-hidden="true" />
        {t('blockBuilder.options.add')}
      </Button>
    </FieldShell>
  );
}

/** Puck custom field `options`. */
export const OptionsField: CustomFieldRender<unknown> = ({ field, name, id, value, onChange, readOnly }) => {
  const m = useContext(BuilderContext);
  const { locale } = useContext(CanvasContext);
  return <OptionsEditor id={id} label={fieldLabel(field, name)} value={value} onChange={onChange} readOnly={readOnly || m?.readOnly} locale={locale} />;
};
