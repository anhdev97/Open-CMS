/**
 * A tiny DDL model. The diff engine produces statements; three consumers use them:
 *   - printStatement()  -> Kysely code written into migration files
 *   - compileStatement() -> SQL shown in the admin UI / `opencloudcms plan`
 *   - executeStatement() -> run directly (tests, tooling)
 */
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  sql,
} from 'kysely';
import type { IndexSpec, PhysicalColumn } from '@opencloudcms/schema';

export type Statement =
  | { type: 'createTable'; table: string; columns: PhysicalColumn[]; primaryKey: { name: string; columns: string[] } }
  | { type: 'dropTable'; table: string }
  | { type: 'renameTable'; from: string; to: string }
  | { type: 'addColumn'; table: string; column: PhysicalColumn }
  | { type: 'dropColumn'; table: string; column: string }
  | { type: 'renameColumn'; table: string; from: string; to: string }
  | { type: 'alterColumnType'; table: string; column: string; toType: string }
  | { type: 'createIndex'; index: IndexSpec }
  | { type: 'dropIndex'; name: string }
  | { type: 'renameIndex'; from: string; to: string };

const IDENT_RE = /^[a-z_][a-z0-9_]*$/;
const TYPE_RE = /^[a-z ]+(\(\d+(, ?\d+)?\))?$/;

function ident(name: string): string {
  if (!IDENT_RE.test(name)) throw new Error(`Unsafe SQL identifier: ${name}`);
  return `"${name}"`;
}
function pgType(type: string): string {
  if (!TYPE_RE.test(type)) throw new Error(`Unsafe SQL type: ${type}`);
  return type;
}
function defaultSql(value: string): string {
  if (!/^(now\(\)|-?\d+|true|false)$/.test(value)) throw new Error(`Unsupported default: ${value}`);
  return value;
}

function rawSql(stmt: Statement): string | null {
  switch (stmt.type) {
    case 'renameIndex':
      return `alter index ${ident(stmt.from)} rename to ${ident(stmt.to)}`;
    case 'alterColumnType':
      return `alter table ${ident(stmt.table)} alter column ${ident(stmt.column)} type ${pgType(stmt.toType)} using ${ident(stmt.column)}::${pgType(stmt.toType)}`;
    default:
      return null;
  }
}

interface Runnable {
  sql: string;
  run: () => Promise<unknown>;
}

function build(db: Kysely<any>, stmt: Statement): Runnable {
  const raw = rawSql(stmt);
  if (raw !== null) {
    const q = sql.raw(raw);
    return { sql: q.compile(db).sql, run: () => q.execute(db) };
  }
  let b: { compile(): { sql: string }; execute(): Promise<unknown> };
  switch (stmt.type) {
    case 'createTable': {
      let t = db.schema.createTable(stmt.table);
      for (const col of stmt.columns) {
        t = t.addColumn(col.name, sql.raw(pgType(col.type)), (c) => {
          let cc = c;
          if (col.notNull) cc = cc.notNull();
          if (col.defaultSql) cc = cc.defaultTo(sql.raw(defaultSql(col.defaultSql)));
          if (col.references) cc = cc.references(`${col.references.table}.${col.references.column}`).onDelete(col.references.onDelete);
          return cc;
        });
      }
      b = t.addPrimaryKeyConstraint(stmt.primaryKey.name, stmt.primaryKey.columns as any);
      break;
    }
    case 'dropTable':
      b = db.schema.dropTable(stmt.table);
      break;
    case 'renameTable':
      b = db.schema.alterTable(stmt.from).renameTo(stmt.to);
      break;
    case 'addColumn': {
      const col = stmt.column;
      b = db.schema.alterTable(stmt.table).addColumn(col.name, sql.raw(pgType(col.type)), (c) => {
        let cc = c;
        if (col.notNull) cc = cc.notNull();
        if (col.defaultSql) cc = cc.defaultTo(sql.raw(defaultSql(col.defaultSql)));
        if (col.references) cc = cc.references(`${col.references.table}.${col.references.column}`).onDelete(col.references.onDelete);
        return cc;
      });
      break;
    }
    case 'dropColumn':
      b = db.schema.alterTable(stmt.table).dropColumn(stmt.column);
      break;
    case 'renameColumn':
      b = db.schema.alterTable(stmt.table).renameColumn(stmt.from, stmt.to);
      break;
    case 'createIndex': {
      let i = db.schema.createIndex(stmt.index.name).on(stmt.index.table).columns(stmt.index.columns);
      if (stmt.index.unique) i = i.unique();
      b = i;
      break;
    }
    case 'dropIndex':
      b = db.schema.dropIndex(stmt.name);
      break;
    default:
      throw new Error(`Unhandled statement ${(stmt as Statement).type}`);
  }
  return { sql: b.compile().sql, run: () => b.execute() };
}

let compilerDb: Kysely<any> | undefined;
function getCompilerDb(): Kysely<any> {
  compilerDb ??= new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  return compilerDb;
}

/** SQL text for previews. */
export function compileStatement(stmt: Statement): string {
  return build(getCompilerDb(), stmt).sql;
}

export async function executeStatement(db: Kysely<any>, stmt: Statement): Promise<void> {
  await build(db, stmt).run();
}

/* ------------------------------------------------------------------ */
/* Code printer: Kysely code for migration files                        */
/* ------------------------------------------------------------------ */

const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function columnCallback(col: PhysicalColumn): string {
  const parts: string[] = [];
  if (col.notNull) parts.push('.notNull()');
  if (col.defaultSql) parts.push(`.defaultTo(sql\`${defaultSql(col.defaultSql)}\`)`);
  if (col.references) {
    parts.push(`.references(${q(`${col.references.table}.${col.references.column}`)}).onDelete(${q(col.references.onDelete)})`);
  }
  return parts.length ? `, (col) => col${parts.join('')}` : '';
}

export function printStatement(stmt: Statement, indent = '  '): string {
  const i2 = indent + '  ';
  switch (stmt.type) {
    case 'createTable': {
      const lines = [`${indent}await db.schema`, `${i2}.createTable(${q(stmt.table)})`];
      for (const col of stmt.columns) {
        lines.push(`${i2}.addColumn(${q(col.name)}, sql\`${pgType(col.type)}\`${columnCallback(col)})`);
      }
      lines.push(`${i2}.addPrimaryKeyConstraint(${q(stmt.primaryKey.name)}, [${stmt.primaryKey.columns.map(q).join(', ')}])`);
      lines.push(`${i2}.execute();`);
      return lines.join('\n');
    }
    case 'dropTable':
      return `${indent}await db.schema.dropTable(${q(stmt.table)}).execute();`;
    case 'renameTable':
      return `${indent}await db.schema.alterTable(${q(stmt.from)}).renameTo(${q(stmt.to)}).execute();`;
    case 'addColumn':
      return `${indent}await db.schema\n${i2}.alterTable(${q(stmt.table)})\n${i2}.addColumn(${q(stmt.column.name)}, sql\`${pgType(stmt.column.type)}\`${columnCallback(stmt.column)})\n${i2}.execute();`;
    case 'dropColumn':
      return `${indent}await db.schema.alterTable(${q(stmt.table)}).dropColumn(${q(stmt.column)}).execute();`;
    case 'renameColumn':
      return `${indent}await db.schema.alterTable(${q(stmt.table)}).renameColumn(${q(stmt.from)}, ${q(stmt.to)}).execute();`;
    case 'createIndex':
      return `${indent}await db.schema\n${i2}.createIndex(${q(stmt.index.name)})\n${i2}.on(${q(stmt.index.table)})\n${i2}.columns([${stmt.index.columns.map(q).join(', ')}])${stmt.index.unique ? `\n${i2}.unique()` : ''}\n${i2}.execute();`;
    case 'dropIndex':
      return `${indent}await db.schema.dropIndex(${q(stmt.name)}).execute();`;
    case 'renameIndex':
    case 'alterColumnType':
      return `${indent}await sql.raw(${q(rawSql(stmt)!)}).execute(db);`;
  }
}
