import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createJiti } from 'jiti';
import { Kysely, PostgresDialect } from 'kysely';
import { defineContentType, f } from '@opencloudcms/schema';
import * as schemaPkg from '@opencloudcms/schema';
import {
  compileStatement, diffSchemas, executeStatement, planMigration, printSchemaFile, renderMigrationFile,
} from '../src';

const dbRequire = createRequire(path.resolve(__dirname, '../../db/package.json'));
const { Pool } = dbRequire('pg') as typeof import('pg');
const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';

const order = (extra: Record<string, unknown> = {}, fields: Record<string, any> = {}) =>
  defineContentType({
    id: 'ct_order', apiId: 'order', displayName: 'Order', ...extra,
    fields: { code: f.text({ id: 'fld_code', required: true, unique: true }), ...fields },
  } as any);

describe('diff / plan for private and readOnly', () => {
  it('a private flip emits a single guard step first, with the exact message', () => {
    const plain = order();
    const priv = order({ private: true }, { total: f.number({ id: 'fld_total' }) });
    const { operations } = diffSchemas([plain], [priv]);
    expect(operations[0]).toMatchObject({ op: 'setPrivate', to: true });
    const plan = planMigration(operations, '20260101000000');
    expect(plan.up[0]).toMatchObject({ type: 'assertTableEmpty', table: 'ct_order' });
    expect(plan.up.slice(1).map(compileStatement)[0]).toContain('add column "total"');
    expect(compileStatement(plan.up[0])).toBe('select 1 from "ct_order" limit 1');
    const file = renderMigrationFile(plan, { name: 'x', generatedAt: 'now' });
    expect(file).toContain('Cannot change "private" on order: the type has entries');
    expect(diffSchemas([priv], [plain]).operations[0]).toMatchObject({ op: 'setPrivate', to: false });
  });

  it('readOnly changes emit no operations and no steps, but count as changed', () => {
    const a = order({}, { items: f.json({ id: 'fld_items' }) });
    const b = order({}, { items: f.json({ id: 'fld_items', readOnly: true }) });
    const r = diffSchemas([a], [b]);
    expect(r.operations).toEqual([]);
    expect(r.changed).toBe(true);
    expect(planMigration(r.operations, '1').up).toEqual([]);
  });

  it('creating a private type needs no guard', () => {
    expect(diffSchemas([], [order({ private: true })]).operations.map((o) => o.op)).toEqual(['createType']);
  });
});

describe('printer round trip', () => {
  const evalSchema = (src: string) => {
    const body = src.replace(/^import .*$/m, '').replace('export default ', 'return ');
    return new Function('defineContentType', 'f', body)(schemaPkg.defineContentType, schemaPkg.f);
  };
  it('prints private and readOnly and re-prints byte-identically', () => {
    const def = order({ private: true }, {
      items: f.json({ id: 'fld_items', readOnly: true }),
      total: f.money({ id: 'fld_total', readOnly: true, required: true }),
    });
    const src = printSchemaFile(def);
    expect(src).toContain('  private: true,');
    expect(src).toContain("items: f.json({ id: 'fld_items', readOnly: true }),");
    const again = evalSchema(src);
    expect(again).toEqual(def);
    expect(printSchemaFile(again)).toBe(src);
  });
  it('omits both when unset (existing files unchanged)', () => {
    const src = printSchemaFile(order());
    expect(src).not.toContain('private');
    expect(src).not.toContain('readOnly');
  });
});

describe('generated migration against Postgres', () => {
  const name = `private_guard_${randomBytes(6).toString('hex')}`;
  const admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
  let db: Kysely<any>;
  let tmp: string;

  beforeAll(async () => {
    await admin.query(`create database ${name}`);
    const u = new URL(ADMIN_URL);
    u.pathname = `/${name}`;
    db = new Kysely({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: u.toString(), max: 2 }) }) });
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ocms-private-'));
  });
  afterAll(async () => {
    await db?.destroy();
    const deadline = Date.now() + 5_000;
    for (;;) {
      const { rows } = await admin.query('select count(*)::int as n from pg_stat_activity where datname = $1', [name]);
      if (rows[0].n === 0 || Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.end();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const load = async (plan: ReturnType<typeof planMigration>, file: string) => {
    const p = path.join(tmp, file);
    fs.writeFileSync(p, renderMigrationFile(plan, { name: file, generatedAt: 'now' }));
    return createJiti(__filename, { interopDefault: false }).import(p) as Promise<{ up(db: Kysely<any>): Promise<void> }>;
  };

  it('passes on an empty table and throws the exact message once a row exists', async () => {
    const plain = order();
    const priv = order({ private: true });
    const create = planMigration(diffSchemas([], [plain]).operations, '20260101000000');
    for (const s of create.up) await executeStatement(db, s);

    const flip = planMigration(diffSchemas([plain], [priv]).operations, '20260101000001');
    const emptyOk = await load(flip, 'flip1.ts');
    await expect(emptyOk.up(db)).resolves.toBeUndefined();
    // executeStatement path agrees
    await expect(executeStatement(db, flip.up[0])).resolves.toBeUndefined();

    await db.insertInto('ct_order').values({ id: '00000000-0000-0000-0000-0000000000aa', document_id: '00000000-0000-0000-0000-000000000001', status: 'draft', code: 'A1' } as any).execute();
    const full = await load(flip, 'flip2.ts');
    await expect(full.up(db)).rejects.toThrow('Cannot change "private" on order: the type has entries');
    await expect(executeStatement(db, flip.up[0])).rejects.toThrow('Cannot change "private" on order: the type has entries');
  });
});
