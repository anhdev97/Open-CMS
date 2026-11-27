// Where one bindable property of an element takes its value from (spec §5.4): a field of the bound content type
// (kind-compatible only), the entry's page URL, a manual field of the block (or a new one), or a fixed value.
import { useId } from 'react';
import { toast } from 'sonner';
import type { BindSource, ComposedElement } from '@opencloudcms/schema';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import { enUS, t } from '../i18n';
import { ImageField } from '../page-editor/ImageField';
import { useBindScope, useBuilder } from './context';
import { propLabel } from './element-config';
import { manualKindFor, sourceOptions, suggestFieldName } from './logic';

const NONE = 'none';
const CONST = 'const';
const NEW = 'new';
const URL_SRC = 'entryUrl';

function encode(s: BindSource | undefined): string {
  if (!s) return NONE;
  switch (s.from) {
    case 'entry':
      return `entry:${s.path}`;
    case 'field':
      return `field:${s.name}`;
    case 'entryUrl':
      return URL_SRC;
    case 'const':
      return CONST;
  }
}

/** English label of a prop (labels of new manual fields are stored under en-US). */
function englishPropLabel(prop: string): string {
  const props = (enUS as { blockBuilder?: { props?: Record<string, string> } }).blockBuilder?.props ?? {};
  return props[prop] ?? prop;
}

interface FixedProps {
  el: ComposedElement;
  prop: string;
  id: string;
  value: unknown;
  readOnly: boolean;
  onChange: (v: unknown) => void;
}

/** Editor of a fixed value, by property. */
function FixedValue({ el, prop, id, value, readOnly, onChange }: FixedProps) {
  if (el === 'Image' && prop === 'src') {
    return (
      <ImageField
        field={{ type: 'custom', label: t('blockBuilder.source.fixedImage') } as never}
        name="src"
        id={id}
        value={(value && typeof value === 'object' ? value : typeof value === 'string' && value ? { src: value, alt: '' } : null) as never}
        readOnly={readOnly}
        onChange={(v) => onChange(v ?? '')}
      />
    );
  }
  if (el === 'Text' && prop === 'html') {
    return <Textarea id={id} value={typeof value === 'string' ? value : ''} readOnly={readOnly} onChange={(e) => onChange(e.target.value)} />;
  }
  if (el === 'Price') {
    return (
      <Input
        id={id}
        type="number"
        step="any"
        readOnly={readOnly}
        value={typeof value === 'number' ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
      />
    );
  }
  if (el === 'Date') {
    return <Input id={id} type="date" readOnly={readOnly} value={typeof value === 'string' ? value.slice(0, 10) : ''} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <Input
      id={id}
      value={typeof value === 'string' ? value : ''}
      readOnly={readOnly}
      placeholder={prop === 'href' ? 'https:// or /path' : undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export interface SourcePickerProps {
  el: ComposedElement;
  prop: string;
  value: BindSource | undefined;
  onChange: (next: BindSource | undefined) => void;
}

/** "Takes its value from" select for one bindable prop, plus the fixed-value editor. */
export function SourcePicker({ el, prop, value, onChange }: SourcePickerProps) {
  const m = useBuilder();
  const selectId = useId();
  const fixedId = useId();
  // Inside a CollectionList the entry is the list's item (its type), elsewhere the block binding's entry.
  const scope = useBindScope();
  const opts = sourceOptions({ el, prop }, { type: scope.type, fields: m.draft.fields, urlPattern: scope.urlPattern });
  const current = encode(value);
  const newKind = manualKindFor(el, prop);
  const typeName = scope.apiId;

  // A bound field the current options do not offer (removed, renamed, wrong kind): shown so the user sees it.
  const stale =
    (value?.from === 'entry' && !opts.entry.some((o) => o.name === value.path) && value.path) ||
    (value?.from === 'field' && !opts.manual.includes(value.name) && value.name) ||
    (value?.from === 'entryUrl' && !opts.entryUrl && 'url') ||
    null;

  const pick = (v: string) => {
    if (v === current) return;
    if (v === NONE) return onChange(undefined);
    if (v === CONST) return onChange({ from: 'const', value: el === 'Price' ? 0 : '' });
    if (v === URL_SRC) return onChange({ from: 'entryUrl' });
    if (v === NEW && newKind) {
      const label = englishPropLabel(prop);
      const name = suggestFieldName(label, m.draft.fields);
      const fixed = value?.from === 'const' ? value.value : undefined;
      const keep = newKind === 'text' || newKind === 'longText' ? typeof fixed === 'string' && fixed : newKind === 'number' && typeof fixed === 'number';
      m.addField(name, { kind: newKind, label: { 'en-US': label }, ...(keep ? { default: fixed } : {}) });
      toast.success(t('blockBuilder.source.fieldCreated', { name }));
      return onChange({ from: 'field', name });
    }
    if (v.startsWith('entry:')) return onChange({ from: 'entry', path: v.slice(6) });
    if (v.startsWith('field:')) return onChange({ from: 'field', name: v.slice(6) });
  };

  return (
    <div className="space-y-1.5 rounded-md border border-border p-2">
      <Label htmlFor={selectId}>{propLabel(prop)}</Label>
      <Select value={current} disabled={m.readOnly} onValueChange={pick}>
        <SelectTrigger id={selectId} className="w-full" aria-label={t('blockBuilder.source.aria', { prop: propLabel(prop) })}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t('blockBuilder.source.none')}</SelectItem>
          {stale && (
            <SelectItem value={current} disabled>
              {t('blockBuilder.source.unavailable', { name: stale })}
            </SelectItem>
          )}
          {opts.entry.length > 0 && (
            <SelectGroup>
              <SelectSeparator />
              <SelectLabel>{t('blockBuilder.source.contentGroup', { type: typeName })}</SelectLabel>
              {opts.entry.map((o) => (
                <SelectItem key={o.name} value={`entry:${o.name}`}>
                  {o.meta ? t(`blockBuilder.source.meta.${o.name}`) : o.label}
                  <span className="text-xs text-muted-foreground">{t(`blockBuilder.kinds.${o.kind}`)}</span>
                </SelectItem>
              ))}
              {opts.entryUrl && <SelectItem value={URL_SRC}>{t('blockBuilder.source.entryUrl')}</SelectItem>}
            </SelectGroup>
          )}
          {scope.type && opts.entry.length === 0 && (
            <SelectGroup>
              <SelectSeparator />
              <SelectLabel>{t('blockBuilder.source.noCompatible', { type: typeName })}</SelectLabel>
            </SelectGroup>
          )}
          <SelectGroup>
            <SelectSeparator />
            <SelectLabel>{t('blockBuilder.source.manualGroup')}</SelectLabel>
            {opts.manual.map((n) => (
              <SelectItem key={n} value={`field:${n}`}>
                {n}
              </SelectItem>
            ))}
            {newKind && !m.readOnly && <SelectItem value={NEW}>{t('blockBuilder.source.newField')}</SelectItem>}
          </SelectGroup>
          <SelectSeparator />
          <SelectItem value={CONST}>{t('blockBuilder.source.fixed')}</SelectItem>
        </SelectContent>
      </Select>
      {value?.from === 'const' && (
        <div className="space-y-1">
          {!(el === 'Image' && prop === 'src') && (
            <Label htmlFor={fixedId} className="text-xs font-normal text-muted-foreground">
              {t('blockBuilder.source.fixedValue')}
            </Label>
          )}
          <FixedValue el={el} prop={prop} id={fixedId} value={value.value} readOnly={m.readOnly} onChange={(v) => onChange({ from: 'const', value: v })} />
        </div>
      )}
      {value?.from === 'field' && <p className="text-xs text-muted-foreground">{t('blockBuilder.source.manualHint')}</p>}
    </div>
  );
}
