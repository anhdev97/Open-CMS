import { describe, expect, it } from 'vitest';
import { PagesService } from '../../src/pages/pages.service';

type Row = Record<string, unknown>;

/** An EntriesService stand-in that applies `mainWhere` and `limit` like the repository (newest first). */
function fakeEntries(rows: Row[]) {
  const calls: Row[] = [];
  return {
    calls,
    async list(_apiId: string, q: { mainWhere?: Record<string, unknown>; limit?: number }) {
      calls.push(q as Row);
      const hits = rows.filter((r) => Object.entries(q.mainWhere ?? {}).every(([k, v]) => r[k] === v));
      return { data: hits.slice(0, q.limit ?? hits.length) };
    },
  };
}

const service = (entries: ReturnType<typeof fakeEntries>) =>
  new PagesService(entries as never, {} as never, { config: { defaultLocale: 'en-US' } } as never, {} as never, {} as never);

describe('PagesService.byPath', () => {
  it('filters kind page in the query, so a newer base row at the same path does not hide the page', async () => {
    const entries = fakeEntries([
      { documentId: 'base-1', kind: 'base', locale: 'en-US', path: '/p' },
      { documentId: 'page-1', kind: 'page', locale: 'en-US', path: '/p' },
    ]);
    const r = await service(entries).byPath('published', '/p', 'en-US');
    expect(r.data.documentId).toBe('page-1');
    expect(entries.calls[0]).toMatchObject({ mainWhere: { kind: 'page' }, filter: { path: '/p' }, locale: 'en-US' });
  });

  it('404 when only a base has the path', async () => {
    const entries = fakeEntries([{ documentId: 'base-1', kind: 'base', locale: 'en-US', path: '/p' }]);
    await expect(service(entries).byPath('draft', '/p', undefined)).rejects.toThrow('No page at /p');
  });
});
