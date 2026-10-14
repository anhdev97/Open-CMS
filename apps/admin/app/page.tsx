'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, type ContentTypeDefinition, type Meta } from '@/lib/api';

export default function Home() {
  const [types, setTypes] = useState<ContentTypeDefinition[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);

  useEffect(() => {
    api<{ data: ContentTypeDefinition[] }>('/api/admin/content-types').then((r) => setTypes(r.data)).catch(() => undefined);
    api<Meta>('/api/admin/meta').then(setMeta).catch(() => undefined);
  }, []);

  return (
    <>
      <div className="page-title">
        <h2>Content types</h2>
        <Link href="/builder">
          <button className="primary">New content type</button>
        </Link>
      </div>
      {meta && (
        <p className="muted">
          Locales: {meta.locales.join(', ')} (default {meta.defaultLocale}) · Schema editing{' '}
          {meta.schemaEditable ? <span className="badge ok">enabled (dev)</span> : <span className="badge warn">read-only</span>}
        </p>
      )}
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>API id</th>
              <th>Fields</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {types.map((t) => (
              <tr key={t.id}>
                <td>
                  <Link href={`/content/${t.apiId}`}>{t.displayName}</Link>
                </td>
                <td className="mono">{t.apiId}</td>
                <td>
                  {t.fields.map((f) => (
                    <span key={f.id} className="badge">
                      {f.name}: {f.kind}
                    </span>
                  ))}
                </td>
                <td>
                  <Link href={`/builder?type=${t.apiId}`}>Edit schema</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
