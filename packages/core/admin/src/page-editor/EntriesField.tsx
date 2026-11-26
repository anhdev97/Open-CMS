import { PlusIcon, XIcon } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { createUsePuck, type CustomFieldRender } from '@puckeditor/core';
import type { EntriesBlockField, StoredEntries } from '@opencloudcms/core/blocks';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { t } from '../i18n';
import type { ContentTypeDefinition, FieldDefinition } from '../lib/types';
import { EntryPicker } from './EntryPicker';
import { FieldShell, PrivateTypeNote, fieldLabel } from './FieldShell';
import { editorFilterFields, entriesApiId, entriesFieldControls, filterableFields, fixedConditionText } from './field-logic';
import { loadContentType } from './data';

const usePuck = createUsePuck();
const NONE = '__none__';

type Query = Extract<StoredEntries, { mode: 'query' }>;

function FilterValue({ id, field, value, onChange, readOnly }: { id: string; field: FieldDefinition | undefined; value: unknown; onChange: (v: unknown) => void; readOnly?: boolean }) {
  if (field?.kind === 'boolean') {
    return (
      <Select value={value === true ? 'true' : value === false ? 'false' : undefined} disabled={readOnly} onValueChange={(v) => onChange(v === 'true')}>
        <SelectTrigger id={id} className="w-full" aria-label={t('pageEditor.fields.entries.filterValue')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">{t('pageEditor.root.yes')}</SelectItem>
          <SelectItem value="false">{t('pageEditor.root.no')}</SelectItem>
        </SelectContent>
      </Select>
    );
  }
  const numeric = field?.kind === 'number';
  return (
    <Input
      id={id}
      type={numeric ? 'number' : 'text'}
      aria-label={t('pageEditor.fields.entries.filterValue')}
      value={value === undefined || value === null ? '' : String(value)}
      readOnly={readOnly}
      onChange={(e) => onChange(numeric ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
    />
  );
}

function QueryBuilder({ id, type, value, bf, onChange, readOnly }: { id: string; type: ContentTypeDefinition | null; value: Query; bf: EntriesBlockField; onChange: (v: Query) => void; readOnly?: boolean }) {
  const controls = entriesFieldControls(bf);
  const sortFields = type ? filterableFields(type) : [];
  const fields = editorFilterFields(sortFields, bf);
  const filter = Object.entries(value.filter ?? {});
  const unused = fields.filter((f) => !filter.some(([k]) => k === f.name));
  const setFilter = (entries: [string, unknown][]) => onChange({ ...value, filter: Object.fromEntries(entries) });
  const [sortField = '', sortDir = 'asc'] = (value.sort ?? '').split(':');

  return (
    <div className="space-y-3">
      {!controls.addFilter && filter.length === 0 ? null : fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('pageEditor.fields.entries.noFilterable')}</p>
      ) : (
        <div className="space-y-2">
          {filter.map(([k, v], i) => (
            <div key={k} className="flex items-center gap-1">
              <Select
                value={k}
                disabled={readOnly}
                onValueChange={(nk) => setFilter(filter.map(([ok, ov], j) => (j === i ? [nk, ''] : [ok, ov])))}
              >
                <SelectTrigger className="w-32 shrink-0" aria-label={t('pageEditor.fields.entries.filterField')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {fields
                    .filter((f) => f.name === k || !filter.some(([ok]) => ok === f.name))
                    .map((f) => (
                      <SelectItem key={f.name} value={f.name}>
                        {f.label ?? f.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <div className="min-w-0 flex-1">
                <FilterValue
                  id={`${id}-filter-${i}`}
                  field={fields.find((f) => f.name === k)}
                  value={v}
                  readOnly={readOnly}
                  onChange={(nv) => setFilter(filter.map(([ok, ov], j) => (j === i ? [ok, nv] : [ok, ov])))}
                />
              </div>
              {!readOnly && (
                <Button type="button" variant="ghost" size="icon-sm" aria-label={t('pageEditor.fields.entries.removeFilter')} onClick={() => setFilter(filter.filter((_, j) => j !== i))}>
                  <XIcon aria-hidden="true" />
                </Button>
              )}
            </div>
          ))}
          {!readOnly && controls.addFilter && unused.length > 0 && (
            <Button type="button" variant="outline" size="sm" onClick={() => setFilter([...filter, [unused[0]!.name, '']])}>
              <PlusIcon aria-hidden="true" />
              {t('pageEditor.fields.entries.addFilter')}
            </Button>
          )}
        </div>
      )}
      {controls.sort && sortFields.length > 0 && (
        <div className="flex items-end gap-1">
          <div className="min-w-0 flex-1 space-y-1">
            <Label htmlFor={`${id}-sort`} className="text-xs text-muted-foreground">
              {t('pageEditor.fields.entries.sort')}
            </Label>
            <Select
              value={sortField || NONE}
              disabled={readOnly}
              onValueChange={(f) => onChange({ ...value, sort: f === NONE ? undefined : `${f}:${sortDir}` })}
            >
              <SelectTrigger id={`${id}-sort`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('pageEditor.fields.entries.sortNone')}</SelectItem>
                {sortFields.map((f) => (
                  <SelectItem key={f.name} value={f.name}>
                    {f.label ?? f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {sortField && (
            <Select value={sortDir} disabled={readOnly} onValueChange={(d) => onChange({ ...value, sort: `${sortField}:${d}` })}>
              <SelectTrigger className="w-32" aria-label={t('pageEditor.fields.entries.sortDirection')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="asc">{t('pageEditor.fields.entries.asc')}</SelectItem>
                <SelectItem value="desc">{t('pageEditor.fields.entries.desc')}</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
      )}
      {controls.limit ? (
      <div className="space-y-1">
        <Label htmlFor={`${id}-limit`} className="text-xs text-muted-foreground">
          {t('pageEditor.fields.entries.limit')}
        </Label>
        <Input
          id={`${id}-limit`}
          type="number"
          min={1}
          max={100}
          readOnly={readOnly}
          value={value.limit ?? bf.limit ?? 10}
          onChange={(e) => onChange({ ...value, limit: Math.min(100, Math.max(1, Number(e.target.value) || 1)) })}
        />
      </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t('pageEditor.fields.entries.lockedLimit', { count: controls.lockedLimit ?? 10 })}</p>
      )}
    </div>
  );
}

/** `b.entries`: pick entries by hand or build a query (filters on indexed/unique fields, sort, limit). */
export const EntriesField: CustomFieldRender<StoredEntries> = ({ field, name, id, value, onChange, readOnly }) => {
  const bf = field.metadata?.blockField as EntriesBlockField;
  const props = usePuck((s) => s.selectedItem?.props as Record<string, unknown> | undefined);
  const apiId = entriesApiId(bf, props ?? {}, name);
  const [type, setType] = useState<ContentTypeDefinition | null>(null);
  const modeId = useId();
  useEffect(() => {
    let live = true;
    setType(null);
    if (apiId) loadContentType(apiId).then((ct) => live && setType(ct), () => undefined);
    return () => {
      live = false;
    };
  }, [apiId]);

  const v: StoredEntries = value && (value.mode === 'pick' || value.mode === 'query') ? value : { mode: 'pick', ids: [] };
  const controls = entriesFieldControls(bf);
  const allowQuery = controls.modeSelect;

  return (
    <FieldShell id={id} label={fieldLabel(field, name)} as="legend">
      <div className="space-y-2">
        {controls.fixed.length > 0 && (
          <p role="note" className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
            {t('pageEditor.fields.entries.fixed', {
              conditions: controls.fixed.map((c) => fixedConditionText(c, type?.fields.find((f) => f.name === c.field), t)).join(', '),
            })}
          </p>
        )}
        {allowQuery && (
          <div className="space-y-1">
            <Label htmlFor={modeId} className="text-xs text-muted-foreground">
              {t('pageEditor.fields.entries.mode')}
            </Label>
            <Select
              value={v.mode}
              disabled={readOnly}
              onValueChange={(m) => onChange(m === 'query' ? { mode: 'query', limit: bf.limit ?? 10 } : { mode: 'pick', ids: [] })}
            >
              <SelectTrigger id={modeId} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pick">{t('pageEditor.fields.entries.pick')}</SelectItem>
                <SelectItem value="query">{t('pageEditor.fields.entries.query')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        {!apiId ? (
          <p className="text-sm text-muted-foreground">{t('pageEditor.fields.entry.noType')}</p>
        ) : type?.private ? (
          <PrivateTypeNote apiId={apiId} />
        ) : v.mode === 'pick' ? (
          <EntryPicker id={id} apiId={apiId} multiple readOnly={readOnly} selected={v.ids} onChange={(ids) => onChange({ mode: 'pick', ids: bf.limit ? ids.slice(0, bf.limit) : ids })} />
        ) : (
          <QueryBuilder id={id} type={type} value={v} bf={bf} readOnly={readOnly} onChange={onChange} />
        )}
      </div>
    </FieldShell>
  );
};
