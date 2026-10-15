import { useEffect, useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { t } from '@/i18n/en';
import { api } from '@/lib/api';
import type { FieldDefinition } from '@/lib/types';

type Option = { value: string; label: string };
const optionCache = new Map<string, Promise<Option[]>>();
const NONE = '__none__';
const META_KEYS = ['documentId', 'status', 'locale', 'createdAt', 'updatedAt', 'publishedAt'];

function loadOptions(field: FieldDefinition): Promise<Option[]> {
  const key =
    field.kind === 'reference' ? `ref:${field.options.target}` : field.kind === 'asset' ? 'assets' : `tax:${field.options.taxonomy}`;
  if (!optionCache.has(key)) {
    const p =
      field.kind === 'reference'
        ? api<{ data: any[] }>(`/api/admin/content/${field.options.target}?limit=100`).then((r) =>
            r.data.map((e) => {
              const title = Object.entries(e).find(([k, v]) => typeof v === 'string' && !META_KEYS.includes(k))?.[1];
              return { value: e.documentId, label: `${title ?? e.documentId}` };
            }),
          )
        : field.kind === 'asset'
          ? api<{ data: any[] }>('/api/admin/assets').then((r) => r.data.map((a) => ({ value: a.id, label: a.filename })))
          : api<{ data: any[] }>(`/api/admin/taxonomies/${field.options.taxonomy}/terms`).then((r) =>
              r.data.map((term) => ({ value: term.id, label: (Object.values(term.name ?? {})[0] as string) ?? term.slug })),
            );
    optionCache.set(
      key,
      p.catch(() => {
        optionCache.delete(key);
        return [];
      }),
    );
  }
  return optionCache.get(key)!;
}

function RelationInput({ id, field, value, onChange }: { id: string; field: FieldDefinition; value: any; onChange: (v: any) => void }) {
  const [options, setOptions] = useState<Option[]>([]);
  useEffect(() => {
    let live = true;
    loadOptions(field).then((o) => live && setOptions(o));
    return () => {
      live = false;
    };
  }, [field.kind, field.options.target, field.options.taxonomy]); // eslint-disable-line react-hooks/exhaustive-deps

  if (field.options.multiple) {
    const selected: string[] = value ?? [];
    const toggle = (v: string, on: boolean) => onChange(on ? [...selected, v] : selected.filter((s) => s !== v));
    return (
      <div
        id={id}
        role="group"
        aria-labelledby={`${id}-label`}
        className="max-h-44 space-y-2 overflow-y-auto rounded-md border border-input p-3"
      >
        {options.length === 0 && <p className="text-sm text-muted-foreground">{t('field.noOptions')}</p>}
        {options.map((o) => (
          <div key={o.value} className="flex items-center gap-2">
            <Checkbox id={`${id}-${o.value}`} checked={selected.includes(o.value)} onCheckedChange={(c) => toggle(o.value, c === true)} />
            <Label htmlFor={`${id}-${o.value}`} className="font-normal">
              {o.label}
            </Label>
          </div>
        ))}
      </div>
    );
  }
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{t('content.noValue')}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function JsonInput({ id, value, onChange }: { id: string; value: any; onChange: (v: any) => void }) {
  const [text, setText] = useState(value == null ? '' : JSON.stringify(value, null, 2));
  const [bad, setBad] = useState(false);
  return (
    <>
      <Textarea
        id={id}
        className="font-mono"
        value={text}
        aria-invalid={bad}
        aria-describedby={bad ? `${id}-error` : undefined}
        onChange={(e) => {
          setText(e.target.value);
          if (!e.target.value.trim()) {
            setBad(false);
            return onChange(null);
          }
          try {
            onChange(JSON.parse(e.target.value));
            setBad(false);
          } catch {
            setBad(true);
          }
        }}
      />
      {bad && (
        <p id={`${id}-error`} className="mt-1 text-sm text-destructive">
          {t('field.invalidJson')}
        </p>
      )}
    </>
  );
}

interface FieldInputProps {
  /** DOM id for the control; the surrounding label points at it with `htmlFor`. */
  id: string;
  field: FieldDefinition;
  value: any;
  onChange: (v: any) => void;
}

export function FieldInput({ id, field, value, onChange }: FieldInputProps) {
  switch (field.kind) {
    case 'longText':
      return <Textarea id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} />;
    case 'richText':
    case 'json':
      return <JsonInput id={id} value={value} onChange={onChange} />;
    case 'number':
      return (
        <Input
          id={id}
          type="number"
          step={field.options.format === 'decimal' ? 'any' : 1}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      );
    case 'boolean':
      return <Checkbox id={id} checked={!!value} onCheckedChange={(c) => onChange(c === true)} />;
    case 'date':
      return <Input id={id} type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} />;
    case 'datetime':
      return (
        <Input
          id={id}
          type="datetime-local"
          value={value ? new Date(value).toISOString().slice(0, 16) : ''}
          onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
        />
      );
    case 'money': {
      const v = value ?? { amount: null, currency: field.options.currency ?? '' };
      return (
        <div className="flex gap-2">
          <Input
            id={id}
            type="number"
            step="any"
            aria-label={t('field.amount')}
            placeholder={t('field.amount')}
            value={v.amount ?? ''}
            onChange={(e) => onChange(e.target.value === '' ? null : { ...v, amount: Number(e.target.value) })}
          />
          <Input
            className="w-24"
            aria-label={t('field.currency')}
            placeholder={t('field.currencyPlaceholder')}
            maxLength={3}
            value={v.currency ?? ''}
            onChange={(e) => onChange({ ...v, currency: e.target.value.toUpperCase() })}
          />
        </div>
      );
    }
    case 'asset':
    case 'reference':
    case 'taxonomy':
      return <RelationInput id={id} field={field} value={value} onChange={onChange} />;
    default:
      return <Input id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} />;
  }
}
