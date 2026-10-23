import { randomUUID } from 'node:crypto';

type Row = Record<string, any>;

/** Minimal in-memory stand-in for the Kysely calls AssetsService makes (Postgres unavailable in some envs). */
export class FakeDb {
  rows: Row[] = [];
  failInsert = false;
  private seq = 0;

  private clone(r: Row) {
    return { ...r };
  }

  insertInto(_t: string) {
    return {
      values: (v: Row) => ({
        returningAll: () => ({
          executeTakeFirstOrThrow: async () => {
            if (this.failInsert) throw new Error('db down');
            const row: Row = {
              id: randomUUID(), mime_type: null, size: null, width: null, height: null, alt: null,
              metadata: null, storage_key: null, provider: null, variants: null,
              created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, this.seq++)),
              ...v,
            };
            if (typeof row.size === 'number') row.size = String(row.size); // pg returns bigint as string
            if (typeof row.variants === 'string') row.variants = JSON.parse(row.variants); // jsonb round trip
            this.rows.push(row);
            return this.clone(row);
          },
        }),
      }),
    };
  }

  selectFrom(_t: string) {
    let id: string | undefined;
    let limit = Infinity;
    const q: any = {
      selectAll: () => q,
      orderBy: () => q,
      limit: (n: number) => ((limit = n), q),
      where: (_c: string, _op: string, v: string) => ((id = v), q),
      execute: async () =>
        [...this.rows].sort((a, b) => +b.created_at - +a.created_at).slice(0, limit).map((r) => this.clone(r)),
      executeTakeFirst: async () => {
        const r = this.rows.find((x) => x.id === id);
        return r ? this.clone(r) : undefined;
      },
    };
    return q;
  }

  updateTable(_t: string) {
    let patch: Row = {};
    let id: string | undefined;
    const q: any = {
      set: (p: Row) => ((patch = p), q),
      where: (_c: string, _op: string, v: string) => ((id = v), q),
      returningAll: () => q,
      executeTakeFirst: async () => {
        const r = this.rows.find((x) => x.id === id);
        if (!r) return undefined;
        Object.assign(r, patch);
        return this.clone(r);
      },
    };
    return q;
  }

  deleteFrom(_t: string) {
    let id: string | undefined;
    const q: any = {
      where: (_c: string, _op: string, v: string) => ((id = v), q),
      execute: async () => {
        this.rows = this.rows.filter((x) => x.id !== id);
        return [];
      },
    };
    return q;
  }
}
