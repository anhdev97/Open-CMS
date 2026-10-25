/**
 * Database access and the two migration streams:
 *   - core migrations (system tables shipped with @opencloudcms/db), tracked in opencms_core_migrations
 *   - project migrations (generated ct_* tables in <project>/migrations), tracked in opencms_migrations
 * Core always runs first. Kysely's migrator takes a lock, so several instances
 * starting at once will not apply the same migration twice.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createJiti } from 'jiti';
import { Kysely, Migrator, PostgresDialect, sql, type Migration, type MigrationProvider, type MigrationResultSet } from 'kysely';
import { Pool, types } from 'pg';
import { SYSTEM_TABLES } from '@opencloudcms/schema';

// Keep `date` columns as 'YYYY-MM-DD' strings instead of timezone-shifted JS Dates.
types.setTypeParser(1082, (v: string) => v);

export function createDb(connectionString: string): Kysely<any> {
  return new Kysely<any>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString, max: 10 }) }) });
}

/* ------------------------------ core ------------------------------ */

export const coreMigrations: Record<string, Migration> = {
  '0001_system_tables': {
    async up(db) {
      await db.schema
        .createTable(SYSTEM_TABLES.assets)
        .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('filename', 'varchar(255)', (c) => c.notNull())
        .addColumn('url', 'varchar(2048)', (c) => c.notNull())
        .addColumn('mime_type', 'varchar(127)')
        .addColumn('size', 'bigint')
        .addColumn('width', 'integer')
        .addColumn('height', 'integer')
        .addColumn('alt', 'varchar(512)')
        .addColumn('metadata', 'jsonb')
        .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
        .execute();
      await db.schema
        .createTable(SYSTEM_TABLES.taxonomies)
        .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('slug', 'varchar(64)', (c) => c.notNull().unique())
        .addColumn('name', 'varchar(255)', (c) => c.notNull())
        .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
        .execute();
      await db.schema
        .createTable(SYSTEM_TABLES.taxonomyTerms)
        .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('taxonomy_id', 'uuid', (c) => c.notNull().references(`${SYSTEM_TABLES.taxonomies}.id`).onDelete('cascade'))
        .addColumn('parent_id', 'uuid', (c) => c.references(`${SYSTEM_TABLES.taxonomyTerms}.id`).onDelete('set null'))
        .addColumn('slug', 'varchar(128)', (c) => c.notNull())
        .addColumn('name', 'jsonb', (c) => c.notNull()) // { "vi-VN": "Ô tô", "en": "Car" }
        .addColumn('sort_order', 'integer', (c) => c.notNull().defaultTo(0))
        .addUniqueConstraint('opencms_taxonomy_terms_slug_uq', ['taxonomy_id', 'slug'])
        .execute();
      await db.schema
        .createTable(SYSTEM_TABLES.entryVersions)
        .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('content_type', 'varchar(64)', (c) => c.notNull())
        .addColumn('document_id', 'uuid', (c) => c.notNull())
        .addColumn('snapshot', 'jsonb', (c) => c.notNull())
        .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
        .execute();
      await db.schema
        .createIndex('opencms_entry_versions_doc_idx')
        .on(SYSTEM_TABLES.entryVersions)
        .columns(['content_type', 'document_id', 'created_at'])
        .execute();
    },
    async down(db) {
      await db.schema.dropTable(SYSTEM_TABLES.entryVersions).execute();
      await db.schema.dropTable(SYSTEM_TABLES.taxonomyTerms).execute();
      await db.schema.dropTable(SYSTEM_TABLES.taxonomies).execute();
      await db.schema.dropTable(SYSTEM_TABLES.assets).execute();
    },
  },
  '0002_region_locales': {
    /**
     * Short locale codes become region codes in every `*_l10n` table. Rows are keyed by (entry_id, locale):
     * a row whose renamed key already exists is left as it is and reported.
     */
    async up(db) {
      const renames: [string, string][] = [['en', 'en-US'], ['vi', 'vi-VN'], ['fr', 'fr-FR'], ['id', 'id-ID']];
      const tables = await sql<{ table_name: string }>`
        select t.table_name from information_schema.tables t
        join information_schema.columns c on c.table_schema = t.table_schema and c.table_name = t.table_name and c.column_name = 'locale'
        where t.table_schema = current_schema() and t.table_type = 'BASE TABLE' and t.table_name like '%\_l10n'
        order by t.table_name`.execute(db);
      let changed = 0;
      for (const { table_name: table } of tables.rows) {
        for (const [from, to] of renames) {
          const res = await sql`
            update ${sql.id(table)} o set locale = ${to}
            where o.locale = ${from}
              and not exists (select 1 from ${sql.id(table)} n where n.entry_id = o.entry_id and n.locale = ${to})`.execute(db);
          changed += Number(res.numAffectedRows ?? 0);
          const left = await sql<{ n: string }>`select count(*)::text as n from ${sql.id(table)} where locale = ${from}`.execute(db);
          const n = Number(left.rows[0]?.n ?? 0);
          if (n > 0) console.warn(`[opencloudcms] 0002_region_locales: ${table}: ${n} "${from}" row(s) kept, "${to}" already exists for the same entry`);
        }
      }
      console.log(`[opencloudcms] 0002_region_locales: renamed ${changed} locale row(s)`);
    },
    async down() {
      // Not reversible: the old short codes are not recorded.
    },
  },
  '0003_workflow': {
    /** Spec B §5.2: review state per document. No row = clean draft. */
    async up(db) {
      await db.schema
        .createTable(SYSTEM_TABLES.workflow)
        .addColumn('api_id', 'text', (c) => c.notNull())
        .addColumn('document_id', 'uuid', (c) => c.notNull())
        .addColumn('state', 'text', (c) => c.notNull().check(sql`state in ('in_review', 'draft')`))
        .addColumn('submitted_by', 'uuid')
        .addColumn('submitted_at', 'timestamptz')
        .addColumn('reviewed_by', 'uuid')
        .addColumn('reviewed_at', 'timestamptz')
        .addColumn('note', 'text')
        .addPrimaryKeyConstraint('opencms_workflow_pk', ['api_id', 'document_id'])
        .execute();
      await db.schema.createIndex('opencms_workflow_state_idx').on(SYSTEM_TABLES.workflow).columns(['state', 'api_id']).execute();
    },
    async down(db) {
      await db.schema.dropTable(SYSTEM_TABLES.workflow).execute();
    },
  },
  '0004_assets_storage': {
    async up(db) {
      await db.schema.alterTable(SYSTEM_TABLES.assets).addColumn('storage_key', 'text').execute();
      await db.schema.alterTable(SYSTEM_TABLES.assets).addColumn('provider', 'text').execute();
      await db.schema.alterTable(SYSTEM_TABLES.assets).addColumn('variants', 'jsonb').execute();
    },
    async down(db) {
      await db.schema.alterTable(SYSTEM_TABLES.assets).dropColumn('variants').execute();
      await db.schema.alterTable(SYSTEM_TABLES.assets).dropColumn('provider').execute();
      await db.schema.alterTable(SYSTEM_TABLES.assets).dropColumn('storage_key').execute();
    },
  },
  '0005_asset_folders': {
    async up(db) {
      await db.schema
        .createTable(SYSTEM_TABLES.assetFolders)
        .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
        .addColumn('parent_id', 'uuid', (c) => c.references(`${SYSTEM_TABLES.assetFolders}.id`).onDelete('restrict'))
        .addColumn('slug', 'varchar(64)', (c) => c.notNull())
        .addColumn('name', 'varchar(255)', (c) => c.notNull())
        .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
        .addUniqueConstraint('opencms_asset_folders_parent_slug_uq', ['parent_id', 'slug'])
        .execute();
      // Unique among root folders (parent_id IS NULL): partial unique index.
      await sql`create unique index opencms_asset_folders_root_slug_uq on ${sql.table(SYSTEM_TABLES.assetFolders)} (slug) where parent_id is null`.execute(db);
      await db.schema
        .alterTable(SYSTEM_TABLES.assets)
        .addColumn('folder_id', 'uuid', (c) => c.references(`${SYSTEM_TABLES.assetFolders}.id`).onDelete('set null'))
        .execute();
      await db.schema.createIndex('opencms_assets_folder_idx').on(SYSTEM_TABLES.assets).column('folder_id').execute();
    },
    async down(db) {
      await db.schema.dropIndex('opencms_assets_folder_idx').execute();
      await db.schema.alterTable(SYSTEM_TABLES.assets).dropColumn('folder_id').execute();
      await sql`drop index if exists opencms_asset_folders_root_slug_uq`.execute(db);
      await db.schema.dropTable(SYSTEM_TABLES.assetFolders).execute();
    },
  },
};

/* ----------------------------- project ---------------------------- */

export class FileMigrationProvider implements MigrationProvider {
  constructor(private readonly dir: string) {}
  async getMigrations(): Promise<Record<string, Migration>> {
    if (!fs.existsSync(this.dir)) return {};
    const jiti = createJiti(path.join(this.dir, 'noop.js'), { moduleCache: false, fsCache: false });
    const out: Record<string, Migration> = {};
    const files = fs.readdirSync(this.dir).filter((f) => /^\d{14}_.+\.(ts|js)$/.test(f)).sort();
    for (const file of files) {
      const mod = await jiti.import<Migration>(path.join(this.dir, file));
      if (typeof mod.up !== 'function') throw new Error(`Migration ${file} has no up() export`);
      out[file.replace(/\.(ts|js)$/, '')] = mod;
    }
    return out;
  }
}

const registeredSources: Record<string, Migration>[] = [];

/**
 * Lets other packages (e.g. @opencloudcms/oauth2) contribute migrations to the core stream.
 * Registering the same object again is a no-op; a key that already exists (built-in or
 * from another source) throws.
 */
export function registerCoreMigrations(source: Record<string, Migration>): void {
  if (registeredSources.includes(source)) return;
  const taken = allCoreMigrations();
  for (const key of Object.keys(source)) {
    if (Object.hasOwn(taken, key)) throw new Error(`Core migration "${key}" is already registered`);
  }
  registeredSources.push(source);
}

/** Built-in core migrations merged with registered sources, sorted by key. */
export function allCoreMigrations(): Record<string, Migration> {
  const merged: Record<string, Migration> = { ...coreMigrations };
  for (const src of registeredSources) Object.assign(merged, src);
  const out: Record<string, Migration> = {};
  for (const key of Object.keys(merged).sort()) out[key] = merged[key];
  return out;
}

/**
 * Unordered on purpose: contributed sources are independent of the built-ins, and their keys
 * (`oauth2_0001_init`) sort after every `000N_*`, so the next built-in would otherwise land before an
 * already executed migration and Kysely would refuse to run.
 */
export function coreMigrator(db: Kysely<any>): Migrator {
  return new Migrator({
    db,
    provider: { getMigrations: async () => allCoreMigrations() },
    allowUnorderedMigrations: true,
    migrationTableName: 'opencms_core_migrations',
    migrationLockTableName: 'opencms_core_migrations_lock',
  });
}

export function projectMigrator(db: Kysely<any>, migrationsDir: string): Migrator {
  return new Migrator({
    db,
    provider: new FileMigrationProvider(migrationsDir),
    migrationTableName: 'opencms_migrations',
    migrationLockTableName: 'opencms_migrations_lock',
  });
}

export interface MigrationRun {
  stream: 'core' | 'project';
  name: string;
  direction: 'Up' | 'Down';
  status: 'Success' | 'Error' | 'NotExecuted';
}

function unwrap(stream: 'core' | 'project', rs: MigrationResultSet): MigrationRun[] {
  const runs = (rs.results ?? []).map((r) => ({ stream, name: r.migrationName, direction: r.direction, status: r.status }));
  if (rs.error) {
    const err = rs.error instanceof Error ? rs.error : new Error(String(rs.error));
    (err as Error & { runs?: MigrationRun[] }).runs = runs;
    err.message = `[${stream}] ${err.message}`;
    throw err;
  }
  return runs;
}

/** Applies pending core migrations, then pending project migrations. */
export async function migrateUp(db: Kysely<any>, migrationsDir: string): Promise<MigrationRun[]> {
  const core = unwrap('core', await coreMigrator(db).migrateToLatest());
  const project = unwrap('project', await projectMigrator(db, migrationsDir).migrateToLatest());
  return [...core, ...project];
}

/** Reverts the last `steps` project migrations (core migrations are never rolled back here). */
export async function migrateDown(db: Kysely<any>, migrationsDir: string, steps = 1): Promise<MigrationRun[]> {
  const runs: MigrationRun[] = [];
  for (let i = 0; i < steps; i++) {
    const r = unwrap('project', await projectMigrator(db, migrationsDir).migrateDown());
    if (!r.length) break;
    runs.push(...r);
  }
  return runs;
}

export interface MigrationStatusRow {
  stream: 'core' | 'project';
  name: string;
  executedAt: Date | null;
}

export async function migrationStatus(db: Kysely<any>, migrationsDir: string): Promise<MigrationStatusRow[]> {
  const core = await coreMigrator(db).getMigrations();
  const project = await projectMigrator(db, migrationsDir).getMigrations();
  return [
    ...core.map((m) => ({ stream: 'core' as const, name: m.name, executedAt: m.executedAt ?? null })),
    ...project.map((m) => ({ stream: 'project' as const, name: m.name, executedAt: m.executedAt ?? null })),
  ];
}

export async function pendingMigrations(db: Kysely<any>, migrationsDir: string): Promise<MigrationStatusRow[]> {
  return (await migrationStatus(db, migrationsDir)).filter((m) => !m.executedAt);
}

export { sql };
