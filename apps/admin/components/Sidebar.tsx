'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, type ContentTypeDefinition } from '@/lib/api';

export function Sidebar() {
  const pathname = usePathname();
  const [types, setTypes] = useState<ContentTypeDefinition[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      api<{ data: ContentTypeDefinition[] }>('/api/admin/content-types')
        .then((r) => {
          setTypes(r.data);
          setError(null);
        })
        .catch((e) => setError(e.message));
    load();
    window.addEventListener('opencms:schema-changed', load);
    return () => window.removeEventListener('opencms:schema-changed', load);
  }, []);

  return (
    <aside className="sidebar">
      <h1>
        opencms <span>admin</span>
      </h1>
      <h2>Content</h2>
      {error && <div className="msg error">API unreachable: {error}</div>}
      {types.map((t) => (
        <Link key={t.id} href={`/content/${t.apiId}`} className={pathname === `/content/${t.apiId}` ? 'active' : ''}>
          {t.displayName}
        </Link>
      ))}
      <h2>Schema</h2>
      <Link href="/builder" className={pathname === '/builder' ? 'active' : ''}>
        Content Type Builder
      </Link>
    </aside>
  );
}
