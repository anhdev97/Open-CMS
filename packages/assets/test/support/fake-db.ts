import { randomUUID } from 'node:crypto';
import { SYSTEM_TABLES } from '@opencloudcms/schema';

type Row = Record<string, any>;
type Pred = (row: Row) => boolean;

/** Minimal in-memory stand-in for the Kysely calls AssetsService / FoldersService make. */
export class FakeDb {
  private tables = new Map<string, Row[]>();
  failInsert = false;
  private seq = 0;

  /** All asset rows (tests still use `db.rows`). */
  get rows(): Row[] {
    return this.table(SYSTEM_TABLES.assets);
  }
  set rows(v: Row[]) {
    this.tables.set(SYSTEM_TABLES.assets, v);
  }

  private table(name: string): Row[] {
    let t = this.tables.get(name);
    if (!t) {
      t = [];
      this.tables.set(name, t);
    }
    return t;
  }

  private clone(r: Row) {
    return { ...r };
  }

  private defaults(table: string): Row {
    if (table === SYSTEM_TABLES.assetFolders) {
      return {
        id: randomUUID(),
        parent_id: null,
        slug: null,
        name: null,
        created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, this.seq++)),
      };
    }
    return {
      id: randomUUID(),
      mime_type: null,
      size: null,
      width: null,
      height: null,
      alt: null,
      metadata: null,
      storage_key: null,
      provider: null,
      variants: null,
      folder_id: null,
      created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, this.seq++)),
    };
  }

  insertInto(table: string) {
    return {
      values: (v: Row) => ({
        returningAll: () => ({
          executeTakeFirstOrThrow: async () => {
            if (this.failInsert) throw new Error('db down');
            const row: Row = { ...this.defaults(table), ...v };
            if (typeof row.size === 'number') row.size = String(row.size);
            if (typeof row.variants === 'string') row.variants = JSON.parse(row.variants);
            this.table(table).push(row);
            return this.clone(row);
          },
        }),
      }),
    };
  }

  selectFrom(table: string) {
    const preds: Pred[] = [];
    let limit = Infinity;
    let order: { col: string; dir: 'asc' | 'desc' } | null = null;
    let cols: string[] | null = null;

    const apply = () => {
      let rows = this.table(table).filter((r) => preds.every((p) => p(r)));
      if (order) {
        const { col, dir } = order;
        rows = [...rows].sort((a, b) => {
          const av = a[col];
          const bv = b[col];
          if (av instanceof Date && bv instanceof Date) return dir === 'asc' ? +av - +bv : +bv - +av;
          const as = String(av ?? '');
          const bs = String(bv ?? '');
          return dir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as);
        });
      }
      return rows.slice(0, limit).map((r) => {
        const c = this.clone(r);
        if (!cols) return c;
        const out: Row = {};
        for (const k of cols) out[k] = c[k];
        return out;
      });
    };

    const addWhere = (col: string, op: string, v: unknown) => {
      if (op === '=' || op === '==') preds.push((r) => r[col] === v);
      else if (op === '!=') preds.push((r) => r[col] !== v);
      else if (op === 'is') preds.push((r) => r[col] == null);
      else if (op === 'is not') preds.push((r) => r[col] != null);
      else if (op === 'in') preds.push((r) => Array.isArray(v) && v.includes(r[col]));
      else throw new Error(`FakeDb: unsupported op ${op}`);
    };

    const q: any = {
      selectAll: () => ((cols = null), q),
      select: (c: string | string[]) => ((cols = Array.isArray(c) ? c : [c]), q),
      orderBy: (col: string, dir: 'asc' | 'desc' = 'asc') => ((order = { col, dir }), q),
      limit: (n: number) => ((limit = n), q),
      where: (col: string, op: string, v: unknown) => (addWhere(col, op, v), q),
      execute: async () => apply(),
      executeTakeFirst: async () => apply()[0],
      executeTakeFirstOrThrow: async () => {
        const r = apply()[0];
        if (!r) throw new Error('no rows');
        return r;
      },
    };
    return q;
  }

  updateTable(table: string) {
    let patch: Row = {};
    const preds: Pred[] = [];
    const addWhere = (col: string, op: string, v: unknown) => {
      if (op === '=' || op === '==') preds.push((r) => r[col] === v);
      else if (op === 'in') preds.push((r) => Array.isArray(v) && v.includes(r[col]));
      else if (op === 'is') preds.push((r) => r[col] == null);
      else throw new Error(`FakeDb: unsupported update op ${op}`);
    };
    const apply = () => {
      const hits = this.table(table).filter((r) => preds.every((p) => p(r)));
      for (const r of hits) Object.assign(r, patch);
      return hits.map((r) => this.clone(r));
    };
    const q: any = {
      set: (p: Row) => ((patch = p), q),
      where: (col: string, op: string, v: unknown) => (addWhere(col, op, v), q),
      returningAll: () => q,
      execute: async () => apply(),
      executeTakeFirst: async () => apply()[0],
      executeTakeFirstOrThrow: async () => {
        const r = apply()[0];
        if (!r) throw new Error('no rows');
        return r;
      },
    };
    return q;
  }

  deleteFrom(table: string) {
    const preds: Pred[] = [];
    const q: any = {
      where: (col: string, op: string, v: unknown) => {
        if (op === '=' || op === '==') preds.push((r) => r[col] === v);
        else if (op === 'in') preds.push((r) => Array.isArray(v) && v.includes(r[col]));
        else throw new Error(`FakeDb: unsupported delete op ${op}`);
        return q;
      },
      execute: async () => {
        const t = this.table(table);
        const keep = t.filter((r) => !preds.every((p) => p(r)));
        this.tables.set(table, keep);
        return [];
      },
    };
    return q;
  }
}
