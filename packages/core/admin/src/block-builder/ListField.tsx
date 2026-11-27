// Settings of a selected CollectionList (spec §1): one Puck custom field per prop (`metadata.part`) — key, content
// type, fixed filters, sort, limit, layout, empty text, entry URL pattern and what page editors may change.
import { PlusIcon, XIcon } from 'lucide-react';
import { useId } from 'react';
import { createUsePuck, type CustomFieldRender } from '@puckeditor/core';
import {
  COLLECTION_LIST_DEFAULT_LIMIT,
  COLLECTION_LIST_KEY_RE,
  COLLECTION_LIST_MAX_LIMIT,
  localizedText,
  SUPPORTED_LOCALES,
  type CollectionListProps,
  type LocalizedText,
} from '@opencloudcms/schema';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Switch } from '../components/ui/switch';
import { getActiveLocale, t } from '../i18n';
import { FieldShell, fieldLabel } from '../page-editor/FieldShell';
import { cleanListEditor } from './collection-list';
import { useBuilder } from './context';
import { defaultFilterValue, filterValueKind, filterableFields, isListy, sortableFields, unindexedFields } from './logic';

const usePuck = createUsePuck();
type Part = 'listKey' | 'apiId' | 'filter' | 'sort' | 'limit' | 'layout' | 'emptyText' | 'urlPattern' | 'editor';
type Filter = NonNullable<CollectionListProps['filter']>;
type Sort = CollectionListProps['sort'];
type Layout = NonNullable<CollectionListProps['layout']>;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const typeName = (ct: { apiId: string; displayName: unknown }) =>
  typeof ct.displayName === 'string' ? ct.displayName : localizedText(ct.displayName as LocalizedText, getActiveLocale() as never, ct.apiId);

/** A CollectionList setting (`metadata.part`). Filters and sort read the list's content type from the selection. */
export const ListField: CustomFieldRender<unknown> = ({ field, name, id, value, onChange }) => {
  const m = useBuilder();
  const part = (field.metadata as { part: Part }).part;
  const selected = usePuck((s) => s.selectedItem?.props as Record<string, unknown> | undefined);
  const apiId = typeof selected?.apiId === 'string' ? selected.apiId : '';
  const type = m.types.find((ct) => ct.apiId === apiId) ?? null;
  const label = fieldLabel(field, name);
  const ro = m.readOnly;

  switch (part) {
    case 'listKey': {
      const v = typeof value === 'string' ? value : '';
      const taken = selected && m.listKeys ? m.listKeys(String(selected.id)) : [];
      const issue = !COLLECTION_LIST_KEY_RE.test(v)
        ? t('blockBuilder.list.keyInvalid')
        : taken.includes(v)
          ? t('blockBuilder.list.keyTaken', { key: v })
          : Object.prototype.hasOwnProperty.call(m.draft.fields, v)
            ? t('blockBuilder.list.keyField', { key: v })
            : null;
      return (
        <FieldShell id={id} label={label}>
          <Input id={id} className="font-mono" value={v} readOnly={ro} aria-invalid={issue ? true : undefined} onChange={(e) => onChange(e.target.value)} />
          <p className={`text-xs ${issue ? 'text-destructive' : 'text-muted-foreground'}`}>{issue ?? t('blockBuilder.list.keyHint')}</p>
        </FieldShell>
      );
    }
    case 'apiId': {
      const missing = apiId && !type;
      return (
        <FieldShell id={id} label={label}>
          <Select value={apiId || undefined} disabled={ro} onValueChange={(v) => onChange(v)}>
            <SelectTrigger id={id} className="w-full">
              <SelectValue placeholder={t('blockBuilder.list.typeNone')} />
            </SelectTrigger>
            <SelectContent>
              {/* Private and core types are not offered (bindableTypes). */}
              {m.types.map((ct) => (
                <SelectItem key={ct.apiId} value={ct.apiId}>
                  {typeName(ct)}
                </SelectItem>
              ))}
              {missing && (
                <SelectItem value={apiId} disabled>
                  {t('blockBuilder.binding.missingType', { type: apiId })}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
          {missing && <p className="text-xs text-warning">{t('blockBuilder.binding.missingType', { type: apiId })}</p>}
        </FieldShell>
      );
    }
    case 'filter':
      return <FilterRows id={id} label={label} type={type} value={Array.isArray(value) ? (value as Filter) : []} readOnly={ro} onChange={(f) => onChange(f.length ? f : undefined)} />;
    case 'sort':
      return <SortSelect id={id} label={label} type={type} value={isObj(value) ? (value as Sort) : undefined} readOnly={ro} onChange={onChange} />;
    case 'limit': {
      const v = typeof value === 'number' ? value : COLLECTION_LIST_DEFAULT_LIMIT;
      return (
        <FieldShell id={id} label={label}>
          <Input
            id={id}
            type="number"
            min={1}
            max={COLLECTION_LIST_MAX_LIMIT}
            readOnly={ro}
            value={v}
            onChange={(e) => {
              const n = Math.round(Number(e.target.value));
              onChange(e.target.value === '' || !Number.isFinite(n) ? undefined : Math.min(Math.max(n, 1), COLLECTION_LIST_MAX_LIMIT));
            }}
          />
          <p className="text-xs text-muted-foreground">{t('blockBuilder.list.limitHint', { max: COLLECTION_LIST_MAX_LIMIT })}</p>
        </FieldShell>
      );
    }
    case 'layout':
      return <LayoutSelect id={id} label={label} value={isObj(value) ? (value as Layout) : { kind: 'grid', columns: 3 }} readOnly={ro} onChange={onChange} />;
    case 'emptyText':
      return <EmptyText label={label} value={isObj(value) ? (value as Partial<LocalizedText>) : {}} readOnly={ro} onChange={onChange} />;
    case 'urlPattern': {
      const v = typeof value === 'string' ? value : '';
      const placeholders = type ? type.fields.filter((f) => !isListy(f) && ['text', 'slug', 'number'].includes(f.kind)).map((f) => f.name) : [];
      const noLink = !!type && !v.trim() && !type.detailPage;
      return (
        <FieldShell id={id} label={label}>
          <Input id={id} value={v} readOnly={ro} placeholder={type?.detailPage?.path ?? '/products/{slug}'} onChange={(e) => onChange(e.target.value.trim() ? e.target.value : undefined)} />
          {!ro && placeholders.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {placeholders.map((p) => (
                <Button key={p} type="button" variant="outline" size="sm" className="h-6 px-2 font-mono text-xs" onClick={() => onChange(`${v}{${p}}`)}>
                  {`{${p}}`}
                </Button>
              ))}
            </div>
          )}
          <p className={`text-xs ${noLink ? 'text-warning' : 'text-muted-foreground'}`}>{t(noLink ? 'blockBuilder.list.noDetail' : 'blockBuilder.list.urlPatternHint')}</p>
        </FieldShell>
      );
    }
    case 'editor':
      return <EditorToggles label={label} value={isObj(value) ? value : {}} readOnly={ro} onChange={onChange} />;
  }
};

type TypeDef = ReturnType<typeof useBuilder>['types'][number] | null;

function FilterRows({ id, label, type, value, readOnly, onChange }: { id: string; label: string; type: TypeDef; value: Filter; readOnly: boolean; onChange: (f: Filter) => void }) {
  if (!type) return null;
  const filterable = filterableFields(type);
  const unindexed = unindexedFields(type);
  return (
    <fieldset id={id} className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      <p className="text-xs text-muted-foreground">{t('blockBuilder.binding.filtersHint')}</p>
      {value.map((flt, i) => {
        const def = type.fields.find((f) => f.name === flt.field);
        const vk = def ? filterValueKind(def) : 'string';
        const setRow = (row: Filter[number]) => onChange(value.map((x, j) => (j === i ? row : x)));
        return (
          <div key={i} className="space-y-1 rounded-md border border-border p-2">
            <div className="flex items-center gap-1">
              <Select
                value={flt.field}
                disabled={readOnly}
                onValueChange={(n) => {
                  const f = type.fields.find((x) => x.name === n);
                  if (f) setRow({ field: n, value: defaultFilterValue(f) });
                }}
              >
                <SelectTrigger className="w-full" aria-label={t('blockBuilder.binding.filterField')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {filterable.map((f) => (
                    <SelectItem key={f.name} value={f.name}>
                      {f.label || f.name}
                    </SelectItem>
                  ))}
                  {unindexed.map((f) => (
                    <SelectItem key={f.name} value={f.name} disabled>
                      {t('blockBuilder.binding.notIndexed', { name: f.label || f.name })}
                    </SelectItem>
                  ))}
                  {!def && flt.field && (
                    <SelectItem value={flt.field} disabled>
                      {t('blockBuilder.source.unavailable', { name: flt.field })}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              {!readOnly && (
                <Button type="button" variant="ghost" size="icon-sm" aria-label={t('blockBuilder.binding.removeFilter')} onClick={() => onChange(value.filter((_, j) => j !== i))}>
                  <XIcon aria-hidden="true" />
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t('blockBuilder.binding.equals')}</span>
              {vk === 'boolean' ? (
                <Switch checked={flt.value === true} disabled={readOnly} aria-label={t('blockBuilder.binding.filterValue')} onCheckedChange={(v) => setRow({ ...flt, value: v })} />
              ) : (
                <Input
                  type={vk === 'number' ? 'number' : 'text'}
                  step="any"
                  readOnly={readOnly}
                  aria-label={t('blockBuilder.binding.filterValue')}
                  value={vk === 'number' ? (typeof flt.value === 'number' ? flt.value : '') : typeof flt.value === 'string' ? flt.value : ''}
                  onChange={(e) => setRow({ ...flt, value: vk === 'number' ? Number(e.target.value || 0) : e.target.value })}
                />
              )}
            </div>
          </div>
        );
      })}
      {!readOnly && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={filterable.length === 0}
          onClick={() => onChange([...value, { field: filterable[0]!.name, value: defaultFilterValue(filterable[0]!) }])}
        >
          <PlusIcon aria-hidden="true" />
          {t('blockBuilder.binding.addFilter')}
        </Button>
      )}
      {unindexed.length > 0 && <p className="text-xs text-muted-foreground">{t('blockBuilder.binding.indexHint')}</p>}
    </fieldset>
  );
}

function SortSelect({ id, label, type, value, readOnly, onChange }: { id: string; label: string; type: TypeDef; value: Sort; readOnly: boolean; onChange: (s: Sort) => void }) {
  if (!type) return null;
  const metaLabel = (f: string) => {
    const k = `blockBuilder.source.meta.${f}`;
    return t(k) !== k ? t(k) : (type.fields.find((x) => x.name === f)?.label ?? f);
  };
  return (
    <FieldShell id={id} label={label}>
      <div className="flex gap-1">
        <Select value={value?.field ?? '__none'} disabled={readOnly} onValueChange={(v) => onChange(v === '__none' ? undefined : { field: v, direction: value?.direction ?? 'desc' })}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">{t('blockBuilder.binding.sortNone')}</SelectItem>
            {sortableFields(type).map((f) => (
              <SelectItem key={f} value={f}>
                {metaLabel(f)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {value && (
          <Select value={value.direction} disabled={readOnly} onValueChange={(v) => onChange({ field: value.field, direction: v as 'asc' | 'desc' })}>
            <SelectTrigger className="w-28 shrink-0" aria-label={t('blockBuilder.binding.direction')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="asc">{t('blockBuilder.binding.asc')}</SelectItem>
              <SelectItem value="desc">{t('blockBuilder.binding.desc')}</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>
    </FieldShell>
  );
}

function LayoutSelect({ id, label, value, readOnly, onChange }: { id: string; label: string; value: Layout; readOnly: boolean; onChange: (l: Layout) => void }) {
  const carousel = value.kind === 'carousel';
  return (
    <FieldShell id={id} label={label}>
      <div className="flex gap-1">
        <Select
          value={value.kind}
          disabled={readOnly}
          onValueChange={(k) =>
            onChange(k === 'list' ? { kind: 'list' } : { kind: k as 'grid' | 'carousel', columns: Math.max(k === 'grid' ? 2 : 1, value.columns ?? 3) })
          }
        >
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="grid">{t('blockBuilder.binding.grid')}</SelectItem>
            <SelectItem value="list">{t('blockBuilder.binding.list')}</SelectItem>
            <SelectItem value="carousel">{t('blockBuilder.binding.carousel')}</SelectItem>
          </SelectContent>
        </Select>
        {value.kind !== 'list' && (
          <Select value={String(value.columns ?? 3)} disabled={readOnly} onValueChange={(c) => onChange({ kind: carousel ? 'carousel' : 'grid', columns: Number(c) })}>
            <SelectTrigger className="w-32 shrink-0" aria-label={t('blockBuilder.binding.columns')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(carousel ? [1, 2, 3, 4, 5, 6] : [2, 3, 4, 5, 6]).map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {t(carousel ? 'blockBuilder.binding.perViewN' : 'blockBuilder.binding.columnsN', { count: n })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </FieldShell>
  );
}

function EmptyText({ label, value, readOnly, onChange }: { label: string; value: Partial<LocalizedText>; readOnly: boolean; onChange: (v: unknown) => void }) {
  const idPrefix = useId();
  const set = (next: Partial<LocalizedText>) => {
    const kept = Object.fromEntries(Object.entries(next).filter(([, v]) => typeof v === 'string' && v.trim() !== ''));
    // The schema needs an en-US text when emptyText is set; nothing typed → no emptyText.
    onChange(Object.keys(kept).length ? { 'en-US': kept['en-US'] ?? '', ...kept } : undefined);
  };
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">{label}</legend>
      <p className="text-xs text-muted-foreground">{t('blockBuilder.binding.emptyTextHint')}</p>
      {SUPPORTED_LOCALES.map((l) => (
        <div key={l.code} className="flex items-center gap-2">
          <Label htmlFor={`${idPrefix}-${l.code}`} className="w-14 shrink-0 font-mono text-xs font-normal text-muted-foreground">
            {l.code}
          </Label>
          <Input id={`${idPrefix}-${l.code}`} value={value[l.code] ?? ''} readOnly={readOnly} aria-label={l.name} onChange={(e) => set({ ...value, [l.code]: e.target.value })} />
        </div>
      ))}
    </fieldset>
  );
}

const EDITOR_KEYS = [
  ['filter', 'editorFilter'],
  ['sort', 'editorSort'],
  ['limit', 'editorLimit'],
  ['layout', 'editorLayout'],
] as const;

function EditorToggles({ label, value, readOnly, onChange }: { label: string; value: Record<string, unknown>; readOnly: boolean; onChange: (v: unknown) => void }) {
  const idPrefix = useId();
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      {EDITOR_KEYS.map(([k, labelKey]) => (
        <div key={k} className="flex items-center gap-2">
          <Switch id={`${idPrefix}-${k}`} checked={value[k] === true} disabled={readOnly} onCheckedChange={(v) => onChange(cleanListEditor({ ...value, [k]: v }))} />
          <Label htmlFor={`${idPrefix}-${k}`} className="font-normal">
            {t(`blockBuilder.binding.${labelKey}`)}
          </Label>
        </div>
      ))}
    </fieldset>
  );
}
