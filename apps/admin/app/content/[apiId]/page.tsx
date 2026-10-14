'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { FieldInput } from '@/components/FieldInput';
import { api, ApiError, formatIssue, type ContentTypeDefinition, type Meta } from '@/lib/api';

type Entry = Record<string, any> & { documentId: string; status: string; publishedAt: string | null; hasUnpublishedChanges?: boolean };

export default function ContentPage() {
  const { apiId } = useParams<{ apiId: string }>();
  const [def, setDef] = useState<ContentTypeDefinition | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [locale, setLocale] = useState<string>('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api<Meta>('/api/admin/meta').then((m) => {
      setMeta(m);
      setLocale((l) => l || m.defaultLocale);
    });
    api<{ data: ContentTypeDefinition }>(`/api/admin/content-types/${apiId}`).then((r) => setDef(r.data)).catch(setError);
  }, [apiId]);

  const reload = useCallback(() => {
    if (!locale) return;
    api<{ data: Entry[]; meta: { total: number } }>(`/api/admin/content/${apiId}?locale=${locale}&limit=50`)
      .then((r) => {
        setEntries(r.data);
        setTotal(r.meta.total);
      })
      .catch(setError);
  }, [apiId, locale]);
  useEffect(reload, [reload]);

  const titleField = def?.fields.find((f) => ['text', 'slug'].includes(f.kind))?.name;

  const openEntry = (entry: Entry | null) => {
    setEditing(entry ?? ({ documentId: '', status: 'draft', publishedAt: null } as Entry));
    setForm(entry ? Object.fromEntries(def!.fields.map((f) => [f.name, entry[f.name]])) : {});
    setError(null);
    setNotice(null);
  };

  useEffect(() => {
    // Re-load the entry in the newly selected locale while editing.
    if (editing?.documentId) {
      api<{ data: Entry }>(`/api/admin/content/${apiId}/${editing.documentId}?locale=${locale}`).then((r) => openEntry(r.data));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(ok);
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(String(e)));
    }
  };

  const save = () =>
    act(async () => {
      // Only send localizable fields when editing another locale's translation.
      const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== undefined));
      const r = editing!.documentId
        ? await api<{ data: Entry }>(`/api/admin/content/${apiId}/${editing!.documentId}?locale=${locale}`, { method: 'PATCH', body: JSON.stringify(body) })
        : await api<{ data: Entry }>(`/api/admin/content/${apiId}?locale=${locale}`, { method: 'POST', body: JSON.stringify(body) });
      setEditing(r.data);
    }, 'Draft saved');

  const refreshEditing = async (id: string) =>
    setEditing((await api<{ data: Entry }>(`/api/admin/content/${apiId}/${id}?locale=${locale}`)).data);
  const publish = (id: string) =>
    act(async () => {
      await api(`/api/admin/content/${apiId}/${id}/publish`, { method: 'POST' });
      await refreshEditing(id);
    }, 'Published');
  const unpublish = (id: string) =>
    act(async () => {
      await api(`/api/admin/content/${apiId}/${id}/unpublish`, { method: 'POST' });
      await refreshEditing(id);
    }, 'Unpublished');
  const remove = (id: string) =>
    confirm('Delete this entry (draft and published)?') &&
    act(async () => {
      await api(`/api/admin/content/${apiId}/${id}`, { method: 'DELETE' });
      setEditing(null);
    }, 'Deleted');

  if (!def) return error ? <div className="msg error">{error.message}</div> : <p className="muted">Loading…</p>;

  return (
    <>
      <div className="page-title">
        <h2>{def.displayName}</h2>
        <div className="row">
          <select value={locale} onChange={(e) => setLocale(e.target.value)}>
            {meta?.locales.map((l) => <option key={l}>{l}</option>)}
          </select>
          <Link href={`/builder?type=${def.apiId}`}><button>Edit schema</button></Link>
          <button className="primary" onClick={() => openEntry(null)}>New entry</button>
        </div>
      </div>

      {notice && <div className="msg ok">{notice}</div>}
      {error && (
        <div className="msg error">
          {error.message}
          {error.issues.length > 0 && <ul>{error.issues.map((x, i) => <li key={i}>{formatIssue(x)}</li>)}</ul>}
        </div>
      )}

      <div className="split">
        <div className="panel">
          <p className="muted" style={{ marginTop: 0 }}>{total} entr{total === 1 ? 'y' : 'ies'} · showing {locale} with fallback to {meta?.defaultLocale}</p>
          <table>
            <thead>
              <tr><th>{titleField ?? 'Entry'}</th><th>Locale</th><th>Status</th><th>Updated</th></tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.documentId}>
                  <td><a href="#" onClick={(ev) => { ev.preventDefault(); openEntry(e); }}>{(titleField && e[titleField]) || <span className="muted">(untitled)</span>}</a></td>
                  <td className="mono">{e.locale ?? '—'}</td>
                  <td>
                    {e.publishedAt ? <span className="badge ok">published</span> : <span className="badge">draft</span>}
                    {e.publishedAt && e.hasUnpublishedChanges && <span className="badge warn">changed</span>}
                  </td>
                  <td className="muted">{new Date(e.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {editing && (
          <div className="panel">
            <div className="head row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
              <strong>{editing.documentId ? 'Edit entry' : 'New entry'}</strong>
              <span className="muted mono">{locale}</span>
            </div>
            {def.fields.map((f) => (
              <label className="fld" key={f.id} style={{ marginBottom: 10 }}>
                <span>
                  {f.label ?? f.name} {f.required && '*'} {f.localizable && <span className="badge">{locale}</span>}
                </span>
                <FieldInput field={f} value={form[f.name]} onChange={(v) => setForm((s) => ({ ...s, [f.name]: v }))} />
              </label>
            ))}
            <div className="row">
              <button className="primary" onClick={save}>Save draft</button>
              {editing.documentId && <button onClick={() => publish(editing.documentId)}>Publish</button>}
              {editing.documentId && editing.publishedAt && <button onClick={() => unpublish(editing.documentId)}>Unpublish</button>}
              <span className="grow" />
              {editing.documentId && <button className="danger" onClick={() => remove(editing.documentId)}>Delete</button>}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
