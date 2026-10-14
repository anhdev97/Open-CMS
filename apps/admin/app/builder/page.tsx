'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import {
  api,
  ApiError,
  formatIssue,
  newId,
  type ApplyResponse,
  type ContentTypeDefinition,
  type FieldDefinition,
  type FieldKind,
  type Meta,
  type PlanResponse,
} from '@/lib/api';

const KIND_LABELS: Record<FieldKind, string> = {
  text: 'Text', longText: 'Long text', richText: 'Rich text', slug: 'Slug', email: 'Email', url: 'URL',
  number: 'Number', boolean: 'Boolean', date: 'Date', datetime: 'Date & time', json: 'JSON',
  money: 'Money', asset: 'Asset', reference: 'Content reference', taxonomy: 'Taxonomy',
};

const emptyType = (): ContentTypeDefinition => ({ id: newId('ct'), apiId: '', displayName: '', fields: [] });
const emptyField = (): FieldDefinition => ({
  id: newId('fld'), name: '', kind: 'text', required: false, localizable: false, indexed: false, unique: false, options: {},
});

function FieldOptions({ field, types, fields, onChange }: {
  field: FieldDefinition;
  types: ContentTypeDefinition[];
  fields: FieldDefinition[];
  onChange: (options: Record<string, any>) => void;
}) {
  const o = field.options;
  const set = (patch: Record<string, any>) => onChange({ ...o, ...patch });
  switch (field.kind) {
    case 'text':
    case 'slug':
      return (
        <>
          <label className="fld">
            Max length
            <input type="number" value={o.maxLength ?? 255} onChange={(e) => set({ maxLength: Number(e.target.value) })} />
          </label>
          {field.kind === 'slug' && (
            <label className="fld">
              Generated from
              <select value={o.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined })}>
                <option value="">—</option>
                {fields.filter((f) => f.kind === 'text' && f.name).map((f) => <option key={f.id}>{f.name}</option>)}
              </select>
            </label>
          )}
        </>
      );
    case 'number':
      return (
        <label className="fld">
          Format
          <select value={o.format ?? 'integer'} onChange={(e) => set({ format: e.target.value })}>
            <option value="integer">Integer</option>
            <option value="decimal">Decimal</option>
          </select>
        </label>
      );
    case 'money':
      return (
        <>
          <label className="fld">
            Currency
            <select value={o.currencyMode ?? 'market'} onChange={(e) => set({ currencyMode: e.target.value })}>
              <option value="market">From market</option>
              <option value="fixed">Fixed</option>
            </select>
          </label>
          {o.currencyMode === 'fixed' && (
            <label className="fld">
              ISO code
              <input value={o.currency ?? ''} maxLength={3} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} />
            </label>
          )}
        </>
      );
    case 'reference':
      return (
        <>
          <label className="fld">
            Target type
            <select value={o.target ?? ''} onChange={(e) => set({ target: e.target.value })}>
              <option value="">Select…</option>
              {types.map((t) => <option key={t.id} value={t.apiId}>{t.displayName}</option>)}
            </select>
          </label>
          <label className="check"><input type="checkbox" checked={!!o.multiple} onChange={(e) => set({ multiple: e.target.checked })} /> Multiple</label>
        </>
      );
    case 'taxonomy':
      return (
        <>
          <label className="fld">
            Taxonomy slug
            <input value={o.taxonomy ?? ''} onChange={(e) => set({ taxonomy: e.target.value })} placeholder="product-category" />
          </label>
          <label className="check"><input type="checkbox" checked={!!o.multiple} onChange={(e) => set({ multiple: e.target.checked })} /> Multiple</label>
        </>
      );
    case 'asset':
      return <label className="check"><input type="checkbox" checked={!!o.multiple} onChange={(e) => set({ multiple: e.target.checked })} /> Multiple</label>;
    default:
      return null;
  }
}

function Builder() {
  const router = useRouter();
  const params = useSearchParams();
  const selected = params.get('type');
  const [meta, setMeta] = useState<Meta | null>(null);
  const [types, setTypes] = useState<ContentTypeDefinition[]>([]);
  const [draft, setDraft] = useState<ContentTypeDefinition>(emptyType);
  const [original, setOriginal] = useState<ContentTypeDefinition | null>(null);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [result, setResult] = useState<ApplyResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [m, t] = await Promise.all([
      api<Meta>('/api/admin/meta'),
      api<{ data: ContentTypeDefinition[] }>('/api/admin/content-types'),
    ]);
    setMeta(m);
    setTypes(t.data);
    return t.data;
  };

  useEffect(() => {
    load().then((all) => {
      const existing = all.find((t) => t.apiId === selected) ?? null;
      setOriginal(existing);
      setDraft(existing ? structuredClone(existing) : emptyType());
      setPlan(null);
      setResult(null);
      setError(null);
    }).catch((e) => setError(e));
  }, [selected]);

  const isNew = !original;
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(original), [draft, original]);

  const updateField = (i: number, patch: Partial<FieldDefinition>) => {
    setDraft((d) => ({ ...d, fields: d.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) }));
    setPlan(null);
  };
  const moveField = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      const fields = [...d.fields];
      const j = i + dir;
      if (j < 0 || j >= fields.length) return d;
      [fields[i], fields[j]] = [fields[j], fields[i]];
      return { ...d, fields };
    });

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(String(e)));
    } finally {
      setBusy(false);
    }
  };

  const preview = () =>
    run(async () => {
      setResult(null);
      setPlan(await api<PlanResponse>('/api/admin/content-types/plan', { method: 'POST', body: JSON.stringify({ definition: draft }) }));
    });

  const save = () =>
    run(async () => {
      const r = await api<ApplyResponse>('/api/admin/content-types', { method: 'POST', body: JSON.stringify({ definition: draft }) });
      setResult(r);
      setPlan(null);
      await load();
      setOriginal(structuredClone(draft));
      window.dispatchEvent(new Event('opencms:schema-changed'));
      if (isNew) router.replace(`/builder?type=${draft.apiId}`);
    });

  const remove = () =>
    run(async () => {
      if (!original || !confirm(`Archive content type "${original.displayName}"? Its tables are renamed, data is kept.`)) return;
      const r = await api<ApplyResponse>(`/api/admin/content-types/${original.id}`, { method: 'DELETE' });
      setResult(r);
      window.dispatchEvent(new Event('opencms:schema-changed'));
      router.replace('/builder');
    });

  const editable = meta?.schemaEditable ?? false;

  return (
    <>
      <div className="page-title">
        <h2>Content Type Builder</h2>
        <div className="row">
          <select value={selected ?? ''} onChange={(e) => router.push(e.target.value ? `/builder?type=${e.target.value}` : '/builder')}>
            <option value="">+ New content type</option>
            {types.map((t) => <option key={t.id} value={t.apiId}>{t.displayName}</option>)}
          </select>
        </div>
      </div>

      {meta && !editable && (
        <div className="msg warn">Schema editing is disabled on this server (production). Change schema files in git and deploy migrations.</div>
      )}

      <div className="split">
        <div>
          <div className="panel">
            <div className="row">
              <label className="fld grow">
                Display name
                <input value={draft.displayName} onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} placeholder="Product" />
              </label>
              <label className="fld grow">
                API id (camelCase)
                <input value={draft.apiId} onChange={(e) => setDraft({ ...draft, apiId: e.target.value })} placeholder="product" />
              </label>
            </div>
            <p className="muted mono" style={{ marginBottom: 0 }}>
              id {draft.id} · table ct_{draft.apiId.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase() || '…'}
              {!isNew && original!.apiId !== draft.apiId && ' · renaming the apiId renames every table and changes the REST path'}
            </p>
          </div>

          {draft.fields.map((field, i) => {
            const multiple = !!field.options.multiple && ['asset', 'reference', 'taxonomy'].includes(field.kind);
            const persisted = original?.fields.find((f) => f.id === field.id);
            return (
              <div className="field-card panel" key={field.id}>
                <div className="head">
                  <strong>{field.name || 'New field'}</strong>
                  <span className="muted mono">
                    {field.id}
                    {persisted && persisted.name !== field.name && ` · rename ${persisted.name} → ${field.name}`}
                  </span>
                  <span>
                    <button onClick={() => moveField(i, -1)} disabled={i === 0}>↑</button>{' '}
                    <button onClick={() => moveField(i, 1)} disabled={i === draft.fields.length - 1}>↓</button>{' '}
                    <button className="danger" onClick={() => setDraft({ ...draft, fields: draft.fields.filter((_, j) => j !== i) })}>Remove</button>
                  </span>
                </div>
                <div className="row">
                  <label className="fld">
                    Name
                    <input value={field.name} onChange={(e) => updateField(i, { name: e.target.value })} placeholder="title" />
                  </label>
                  <label className="fld">
                    Kind
                    <select value={field.kind} onChange={(e) => updateField(i, { kind: e.target.value as FieldKind, options: {} })}>
                      {(meta?.fieldKinds ?? (Object.keys(KIND_LABELS) as FieldKind[])).map((k) => (
                        <option key={k} value={k}>{KIND_LABELS[k]}</option>
                      ))}
                    </select>
                  </label>
                  <label className="fld grow">
                    Label
                    <input value={field.label ?? ''} onChange={(e) => updateField(i, { label: e.target.value || undefined })} />
                  </label>
                  <FieldOptions field={field} types={types} fields={draft.fields} onChange={(options) => updateField(i, { options })} />
                </div>
                <div style={{ marginTop: 10 }}>
                  <label className="check"><input type="checkbox" checked={field.required} onChange={(e) => updateField(i, { required: e.target.checked })} /> Required</label>
                  <label className="check"><input type="checkbox" checked={field.localizable} disabled={multiple} onChange={(e) => updateField(i, { localizable: e.target.checked })} /> Localizable</label>
                  <label className="check"><input type="checkbox" checked={field.indexed || field.unique} disabled={multiple || field.unique} onChange={(e) => updateField(i, { indexed: e.target.checked })} /> Indexed (filter / sort)</label>
                  <label className="check"><input type="checkbox" checked={field.unique} disabled={multiple} onChange={(e) => updateField(i, { unique: e.target.checked, indexed: e.target.checked || field.indexed })} /> Unique</label>
                </div>
              </div>
            );
          })}

          <div className="row">
            <button onClick={() => setDraft({ ...draft, fields: [...draft.fields, emptyField()] })}>+ Add field</button>
            <span className="grow" />
            {!isNew && <button className="danger" disabled={!editable || busy} onClick={remove}>Archive type</button>}
            <button disabled={busy} onClick={preview}>Preview migration</button>
            <button className="primary" disabled={!editable || busy || !dirty} onClick={save}>
              {busy ? 'Working…' : 'Save & generate'}
            </button>
          </div>
        </div>

        <div>
          <div className="panel">
            <strong>What happens on save</strong>
            <ol className="muted" style={{ paddingLeft: 18, marginBottom: 0 }}>
              <li>The schema file <span className="mono">src/content-types/{draft.apiId || '<apiId>'}/…schema.ts</span> is written</li>
              <li>A migration is generated in <span className="mono">migrations/</span> by diffing with the snapshot</li>
              <li>Types, validators and registry are regenerated in <span className="mono">src/generated/</span></li>
              <li>The migration is applied; if it fails, every file is rolled back</li>
            </ol>
          </div>

          {error && (
            <div className="msg error">
              {error.message}
              {error.issues.length > 0 && <ul>{error.issues.map((x, i) => <li key={i}>{formatIssue(x)}</li>)}</ul>}
            </div>
          )}

          {plan && (
            <div className="panel">
              <strong>Migration preview</strong>
              {!plan.changed && <p className="muted">No changes.</p>}
              {plan.changed && plan.sql.length === 0 && <p className="muted">Metadata only (labels, required…). No SQL needed.</p>}
              <ul>{plan.summary.map((s) => <li key={s}>{s}</li>)}</ul>
              {plan.warnings.map((w) => <div key={w} className="msg warn">{w}</div>)}
              {plan.sql.length > 0 && <pre className="sql">{plan.sql.map((s) => `${s};`).join('\n')}</pre>}
            </div>
          )}

          {result && (
            <div className="panel">
              <div className="msg ok">
                {result.status === 'created' ? 'Migration created and applied.' : result.status === 'metadata-only' ? 'Metadata updated.' : 'Nothing changed.'}
              </div>
              <p className="muted" style={{ margin: '6px 0' }}>Commit these files:</p>
              <ul className="mono">
                {result.schemaFile && <li>{result.schemaFile}</li>}
                {result.migrationFile && <li>{result.migrationFile}</li>}
                <li>migrations/_snapshot.json</li>
                {result.generated.map((g) => <li key={g}>{g}</li>)}
              </ul>
              {result.warnings.map((w) => <div key={w} className="msg warn">{w}</div>)}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default function BuilderPage() {
  return (
    <Suspense>
      <Builder />
    </Suspense>
  );
}
