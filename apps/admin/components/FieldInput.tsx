'use client';

import { useEffect, useState } from 'react';
import { api, type FieldDefinition } from '@/lib/api';

type Option = { value: string; label: string };
const optionCache = new Map<string, Promise<Option[]>>();

function loadOptions(field: FieldDefinition): Promise<Option[]> {
  const key = field.kind === 'reference' ? `ref:${field.options.target}` : field.kind === 'asset' ? 'assets' : `tax:${field.options.taxonomy}`;
  if (!optionCache.has(key)) {
    const p =
      field.kind === 'reference'
        ? api<{ data: any[] }>(`/api/admin/content/${field.options.target}?limit=100`).then((r) =>
            r.data.map((e) => {
              const title = Object.entries(e).find(([k, v]) => typeof v === 'string' && !['documentId', 'status', 'locale', 'createdAt', 'updatedAt', 'publishedAt'].includes(k))?.[1];
              return { value: e.documentId, label: `${title ?? e.documentId}` };
            }),
          )
        : field.kind === 'asset'
          ? api<{ data: any[] }>('/api/admin/assets').then((r) => r.data.map((a) => ({ value: a.id, label: a.filename })))
          : api<{ data: any[] }>(`/api/admin/taxonomies/${field.options.taxonomy}/terms`).then((r) =>
              r.data.map((t) => ({ value: t.id, label: Object.values(t.name ?? {})[0] as string ?? t.slug })),
            );
    optionCache.set(key, p.catch(() => []));
  }
  return optionCache.get(key)!;
}

function RelationInput({ field, value, onChange }: { field: FieldDefinition; value: any; onChange: (v: any) => void }) {
  const [options, setOptions] = useState<Option[]>([]);
  useEffect(() => {
    loadOptions(field).then(setOptions);
  }, [field]);
  if (field.options.multiple) {
    const selected: string[] = value ?? [];
    return (
      <select multiple value={selected} onChange={(e) => onChange(Array.from(e.target.selectedOptions, (o) => o.value))} style={{ minHeight: 80 }}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">—</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function JsonInput({ value, onChange }: { value: any; onChange: (v: any) => void }) {
  const [text, setText] = useState(value == null ? '' : JSON.stringify(value, null, 2));
  const [bad, setBad] = useState(false);
  return (
    <>
      <textarea
        value={text}
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
      {bad && <span style={{ color: 'var(--danger)' }}>Invalid JSON</span>}
    </>
  );
}

export function FieldInput({ field, value, onChange }: { field: FieldDefinition; value: any; onChange: (v: any) => void }) {
  switch (field.kind) {
    case 'longText':
      return <textarea value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} />;
    case 'richText':
    case 'json':
      return <JsonInput value={value} onChange={onChange} />;
    case 'number':
      return (
        <input
          type="number"
          step={field.options.format === 'decimal' ? 'any' : 1}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      );
    case 'boolean':
      return <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
    case 'date':
      return <input type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} />;
    case 'datetime':
      return (
        <input
          type="datetime-local"
          value={value ? new Date(value).toISOString().slice(0, 16) : ''}
          onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
        />
      );
    case 'money': {
      const v = value ?? { amount: null, currency: field.options.currency ?? '' };
      return (
        <div className="row">
          <input type="number" step="any" placeholder="amount" value={v.amount ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : { ...v, amount: Number(e.target.value) })} />
          <input style={{ width: 70 }} placeholder="VND" maxLength={3} value={v.currency ?? ''} onChange={(e) => onChange({ ...v, currency: e.target.value.toUpperCase() })} />
        </div>
      );
    }
    case 'asset':
    case 'reference':
    case 'taxonomy':
      return <RelationInput field={field} value={value} onChange={onChange} />;
    default:
      return <input value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} />;
  }
}
