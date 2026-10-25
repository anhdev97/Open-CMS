/**
 * The one pipeline shared by the CLI and the admin UI:
 *
 *   schema files -> validate -> diff with _snapshot.json -> migration file
 *                                                        -> src/generated/*
 *                                                        -> _snapshot.json
 *
 * The UI never runs DDL directly: it writes a schema file and calls this.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ContentTypeDefinition, ResolvedConfig } from '@opencloudcms/schema';
import { assertValidSchema, normalizeDefinition } from '@opencloudcms/schema';
import { generateCode, staleGeneratedFiles, writeGeneratedFiles } from './codegen';
import { compileStatement } from './ddl';
import { diffSchemas, type DiffResult } from './diff';
import { loadContentGroups, loadDefinitions, type LoadedDefinition } from './loader';
import { migrationStamp, renderMigrationFile, slugifyMigrationName, suggestMigrationName } from './migration-file';
import { planMigration, type MigrationPlan } from './plan';
import { printSchemaFile } from './printer';
import { readSnapshot, writeSnapshot, type Snapshot } from './snapshot';

export interface PlanResult {
  definitions: ContentTypeDefinition[];
  snapshot: Snapshot;
  diff: DiffResult;
  plan: MigrationPlan;
  stamp: string;
  /** SQL for the `up` direction, for previews. */
  sql: string[];
}

/**
 * Migrations run in file-name order, so a new stamp must sort after every
 * existing migration (two changes within the same second would otherwise
 * be ordered by name).
 */
export function nextMigrationStamp(migrationsDir: string, now = new Date()): string {
  const stamp = migrationStamp(now);
  const existing = fs.existsSync(migrationsDir)
    ? fs.readdirSync(migrationsDir).map((f) => /^(\d{14})_/.exec(f)?.[1]).filter((s): s is string => !!s).sort()
    : [];
  const latest = existing.at(-1);
  if (!latest || stamp > latest) return stamp;
  const d = new Date(
    Date.UTC(+latest.slice(0, 4), +latest.slice(4, 6) - 1, +latest.slice(6, 8), +latest.slice(8, 10), +latest.slice(10, 12), +latest.slice(12, 14) + 1),
  );
  return migrationStamp(d);
}

export async function computePlan(
  config: ResolvedConfig,
  opts: { definitions?: ContentTypeDefinition[]; now?: Date } = {},
): Promise<PlanResult> {
  const definitions = opts.definitions ?? (await loadDefinitions(config)).map((l) => l.def);
  assertValidSchema(definitions, await loadContentGroups(config));
  const snapshot = readSnapshot(config.migrationsDir);
  const diff = diffSchemas(snapshot.contentTypes, definitions);
  const stamp = nextMigrationStamp(config.migrationsDir, opts.now);
  const plan = planMigration(diff.operations, stamp);
  return { definitions, snapshot, diff, plan, stamp, sql: plan.up.map(compileStatement) };
}

export type CreateMigrationResult =
  | { status: 'up-to-date'; generated: string[] }
  | { status: 'metadata-only'; generated: string[]; plan: PlanResult }
  | { status: 'created'; file: string; generated: string[]; plan: PlanResult };

export async function createMigration(
  config: ResolvedConfig,
  opts: { name?: string; now?: Date; definitions?: ContentTypeDefinition[] } = {},
): Promise<CreateMigrationResult> {
  const result = await computePlan(config, opts);
  const generated = writeGeneratedFiles(generateCode(result.definitions, config.generatedDir));
  if (!result.diff.changed) return { status: 'up-to-date', generated };

  if (result.diff.operations.length === 0 || result.plan.up.length === 0) {
    writeSnapshot(config.migrationsDir, { ...result.snapshot, contentTypes: result.definitions });
    return { status: 'metadata-only', generated, plan: result };
  }

  const name = opts.name ? slugifyMigrationName(opts.name) : suggestMigrationName(result.plan);
  fs.mkdirSync(config.migrationsDir, { recursive: true });
  let file = path.join(config.migrationsDir, `${result.stamp}_${name}.ts`);
  for (let i = 2; fs.existsSync(file); i++) file = path.join(config.migrationsDir, `${result.stamp}_${name}_${i}.ts`);
  fs.writeFileSync(file, renderMigrationFile(result.plan, { name, generatedAt: new Date().toISOString() }));
  writeSnapshot(config.migrationsDir, {
    version: 1,
    lastMigration: path.basename(file, '.ts'),
    contentTypes: result.definitions,
  });
  return { status: 'created', file, generated, plan: result };
}

export async function generate(config: ResolvedConfig): Promise<{ definitions: ContentTypeDefinition[]; changed: string[] }> {
  const definitions = (await loadDefinitions(config)).map((l) => l.def);
  assertValidSchema(definitions, await loadContentGroups(config));
  return { definitions, changed: writeGeneratedFiles(generateCode(definitions, config.generatedDir)) };
}

export interface SchemaCheck {
  ok: boolean;
  problems: string[];
}

/** For CI: fails when definitions changed without a migration, or generated code is stale. */
export async function checkSchema(config: ResolvedConfig): Promise<SchemaCheck> {
  const problems: string[] = [];
  const result = await computePlan(config);
  if (result.diff.changed) {
    problems.push(
      result.diff.operations.length
        ? `Schema changed without a migration (${result.plan.summary.join('; ')}). Run \`opencloudcms migrate:create\`.`
        : 'Schema metadata changed; run `opencloudcms migrate:create` to update migrations/_snapshot.json.',
    );
  }
  for (const f of staleGeneratedFiles(generateCode(result.definitions, config.generatedDir))) {
    problems.push(`Generated file is stale: ${path.relative(config.root, f)}. Run \`opencloudcms generate\`.`);
  }
  return { ok: problems.length === 0, problems };
}

/* ------------------------------------------------------------------ */
/* File transactions: undo everything the pipeline wrote if a later     */
/* step (e.g. applying the migration) fails.                             */
/* ------------------------------------------------------------------ */

export type FileSnapshot = Map<string, string>;

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(p) : [p];
  });
}

export function captureProjectFiles(config: ResolvedConfig): FileSnapshot {
  const snap: FileSnapshot = new Map();
  for (const dir of [config.contentTypesDir, config.generatedDir, config.migrationsDir]) {
    for (const f of listFiles(dir)) snap.set(f, fs.readFileSync(f, 'utf8'));
  }
  return snap;
}

export function restoreProjectFiles(config: ResolvedConfig, snap: FileSnapshot): void {
  for (const dir of [config.contentTypesDir, config.generatedDir, config.migrationsDir]) {
    for (const f of listFiles(dir)) if (!snap.has(f)) fs.rmSync(f);
  }
  for (const [f, content] of snap) {
    if (!fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== content) {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, content);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Schema file editing (used by the admin UI and `content-type:add`)    */
/* ------------------------------------------------------------------ */

function fileFor(config: ResolvedConfig, loaded: LoadedDefinition[], def: ContentTypeDefinition): string {
  const existing = loaded.find((l) => l.def.id === def.id);
  return existing?.file ?? path.join(config.contentTypesDir, def.apiId, `${def.apiId}.schema.ts`);
}

/** Definitions as they would be after upserting / removing one content type (nothing is written). */
export async function definitionsWith(
  config: ResolvedConfig,
  change: { upsert?: ContentTypeDefinition; removeId?: string },
): Promise<{ loaded: LoadedDefinition[]; definitions: ContentTypeDefinition[] }> {
  const loaded = await loadDefinitions(config);
  let definitions = loaded.map((l) => l.def);
  if (change.upsert) {
    const def = normalizeDefinition(change.upsert);
    const i = definitions.findIndex((d) => d.id === def.id);
    definitions = i >= 0 ? definitions.map((d, j) => (j === i ? def : d)) : [...definitions, def];
  }
  if (change.removeId) definitions = definitions.filter((d) => d.id !== change.removeId);
  return { loaded, definitions };
}

export async function previewChange(
  config: ResolvedConfig,
  change: { upsert?: ContentTypeDefinition; removeId?: string },
): Promise<PlanResult> {
  const { definitions } = await definitionsWith(config, change);
  return computePlan(config, { definitions });
}

/**
 * Writes (or deletes) the schema file for one content type. Validation and the
 * diff run first, so an invalid change never touches the disk.
 */
export async function writeSchemaChange(
  config: ResolvedConfig,
  change: { upsert?: ContentTypeDefinition; removeId?: string },
): Promise<{ file: string | null; definitions: ContentTypeDefinition[] }> {
  const { loaded, definitions } = await definitionsWith(config, change);
  await computePlan(config, { definitions }); // throws on invalid / unsupported change
  if (change.upsert) {
    const def = normalizeDefinition(change.upsert);
    const file = fileFor(config, loaded, def);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, printSchemaFile(def));
    return { file, definitions };
  }
  const victim = loaded.find((l) => l.def.id === change.removeId);
  if (victim) fs.rmSync(victim.file);
  return { file: victim?.file ?? null, definitions };
}
