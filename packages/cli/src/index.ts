// Registers the oauth2 core migrations so migrate:up/status see them (R8). Nest-free entry.
import '@opencloudcms/oauth2/migrations';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Command } from 'commander';
import {
  checkSchema,
  computePlan,
  createMigration,
  DiffError,
  findProjectRoot,
  generate,
  loadConfig,
  loadDefinitions,
  writeSchemaChange,
} from '@opencloudcms/codegen';
import { loadProjectEnv } from './env';
import { nextSteps, runInit } from './init';
import { createDb, migrateDown, migrateUp, migrationStatus } from '@opencloudcms/db';
import type { ContentTypeDefinition, FieldDefinition, FieldKind, ResolvedConfig } from '@opencloudcms/schema';
import { FIELD_KINDS, newId, SchemaValidationError } from '@opencloudcms/schema';

const c = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

async function project(): Promise<ResolvedConfig> {
  const root = findProjectRoot(process.env.OPENCLOUDCMS_ROOT ?? process.cwd());
  loadProjectEnv(root);
  return loadConfig(root);
}

const rel = (config: ResolvedConfig, p: string) => path.relative(config.root, p) || '.';

async function withDb<T>(config: ResolvedConfig, fn: (db: ReturnType<typeof createDb>) => Promise<T>): Promise<T> {
  if (!config.database?.url) throw new Error('database.url is not set in opencloudcms.config.ts (usually from DATABASE_URL).');
  const db = createDb(config.database.url);
  try {
    return await fn(db);
  } finally {
    await db.destroy();
  }
}

function run(fn: (...args: any[]) => Promise<void>) {
  return async (...args: any[]) => {
    try {
      await fn(...args);
    } catch (e) {
      if (e instanceof SchemaValidationError || e instanceof DiffError) {
        console.error(c.red(e.name === 'DiffError' ? 'Unsupported schema change:' : 'Invalid schema:'));
        for (const i of e.issues) console.error(`  - ${i}`);
      } else {
        console.error(c.red((e as Error).message ?? String(e)));
        if (process.env.OPENCLOUDCMS_DEBUG) console.error(e);
      }
      process.exitCode = 1;
    }
  };
}

function printPlan(summary: string[], warnings: string[], sql?: string[]) {
  for (const s of summary) console.log(`  ${c.green('+')} ${s}`);
  for (const w of warnings) console.log(`  ${c.yellow('!')} ${w}`);
  if (sql?.length) {
    console.log(c.dim('\n  SQL:'));
    for (const s of sql) console.log(c.dim(`    ${s};`));
  }
}

/**
 * Field spec syntax for `content-type:add` / `field:add`:
 *   name:kind[:flag...]      flags: required, localizable, indexed, unique, multiple
 *   kind options:            text(120)  number(decimal)  reference(brand)  taxonomy(product-category)
 *                            money(VND)  asset[]  reference(product)[]
 */
export function parseFieldSpec(spec: string): FieldDefinition {
  const [name, kindRaw, ...flags] = spec.split(':');
  if (!name || !kindRaw) throw new Error(`Invalid field "${spec}". Use name:kind[:required:localizable:indexed:unique]`);
  const m = /^([a-zA-Z]+)(?:\(([^)]*)\))?(\[\])?$/.exec(kindRaw);
  if (!m) throw new Error(`Invalid field kind "${kindRaw}"`);
  const kind = m[1] as FieldKind;
  if (!FIELD_KINDS.includes(kind)) throw new Error(`Unknown kind "${kind}". Available: ${FIELD_KINDS.join(', ')}`);
  const arg = m[2];
  const options: Record<string, unknown> = {};
  if (m[3] || flags.includes('multiple')) options.multiple = true;
  if (arg) {
    if (kind === 'text' || kind === 'slug') options.maxLength = Number(arg);
    else if (kind === 'number') options.format = arg === 'decimal' ? 'decimal' : 'integer';
    else if (kind === 'reference') options.target = arg;
    else if (kind === 'taxonomy') options.taxonomy = arg;
    else if (kind === 'money') Object.assign(options, { currencyMode: 'fixed', currency: arg.toUpperCase() });
  }
  if (kind === 'money' && !options.currencyMode) options.currencyMode = 'market';
  return {
    id: newId('fld'),
    name,
    kind,
    required: flags.includes('required'),
    localizable: flags.includes('localizable'),
    unique: flags.includes('unique'),
    indexed: flags.includes('indexed') || flags.includes('unique'),
    options: options as any,
  };
}

const program = new Command();
program.name('opencloudcms').description('@opencloudcms/cli: schema-as-code headless CMS tooling').version('0.1.0');

program
  .command('init <dir>')
  .description('Scaffold a new OpenCloudCMS project in <dir>')
  .option('--pm <pm>', 'package manager: pnpm | npm | yarn')
  .option('--no-install', 'do not install dependencies')
  .option('--db-url <url>', 'database URL written to .env')
  .option('--port <n>', 'server port', '4000')
  .option('--link <path>', 'link internal packages from an OpenCloudCMS monorepo checkout')
  .action(
    run(async (dir: string, opts: { pm?: string; install: boolean; dbUrl?: string; port: string; link?: string }) => {
      if (opts.pm && !['pnpm', 'npm', 'yarn'].includes(opts.pm)) throw new Error(`Unknown package manager "${opts.pm}". Use pnpm, npm or yarn.`);
      const port = Number(opts.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid port "${opts.port}"`);
      const r = await runInit(dir, {
        pm: opts.pm as 'pnpm' | 'npm' | 'yarn' | undefined,
        install: opts.install,
        dbUrl: opts.dbUrl,
        port,
        link: opts.link,
        cliVersion: program.version() as string,
        userAgent: process.env.npm_config_user_agent,
      });
      console.log(`${c.green('✓')} Created ${c.bold(dir)} (${r.files.length} files)${r.installed ? ', dependencies installed' : ''}\n`);
      console.log(nextSteps(dir, r));
    }),
  );

program
  .command('generate')
  .description('Generate src/generated/* (types, table types, validators, registry) from schema files')
  .action(
    run(async () => {
      const config = await project();
      const { definitions, changed } = await generate(config);
      console.log(`${c.green('✓')} ${definitions.length} content type(s), ${changed.length} file(s) updated`);
      for (const f of changed) console.log(c.dim(`  ${rel(config, f)}`));
    }),
  );

program
  .command('plan')
  .description('Show the migration that migrate:create would generate, without writing anything')
  .action(
    run(async () => {
      const config = await project();
      const r = await computePlan(config);
      if (!r.diff.changed) return console.log(`${c.green('✓')} Schema is in sync with migrations/_snapshot.json`);
      if (!r.plan.up.length) return console.log('Only metadata changed (labels, required, ...). No DDL needed.');
      printPlan(r.plan.summary, r.plan.warnings, r.sql);
    }),
  );

program
  .command('migrate:create [name]')
  .description('Diff schema files against the snapshot and write a migration + generated code')
  .action(
    run(async (name?: string) => {
      const config = await project();
      const r = await createMigration(config, { name });
      if (r.status === 'up-to-date') return console.log(`${c.green('✓')} No schema changes`);
      if (r.status === 'metadata-only') {
        return console.log(`${c.green('✓')} Metadata-only change: snapshot and generated code updated, no migration needed`);
      }
      console.log(`${c.green('✓')} Created ${c.bold(rel(config, r.file))}`);
      printPlan(r.plan.plan.summary, r.plan.plan.warnings);
      console.log(c.dim('\n  Review the file, then run `opencloudcms migrate:up`.'));
    }),
  );

program
  .command('migrate:up')
  .description('Apply pending core and project migrations')
  .action(
    run(async () => {
      const config = await project();
      const runs = await withDb(config, (db) => migrateUp(db, config.migrationsDir));
      if (!runs.length) return console.log(`${c.green('✓')} Database is up to date`);
      for (const r of runs) console.log(`  ${c.green('↑')} ${r.stream}/${r.name}`);
    }),
  );

program
  .command('migrate:down')
  .description('Revert the last project migration(s)')
  .option('-s, --steps <n>', 'how many migrations to revert', '1')
  .action(
    run(async (opts: { steps: string }) => {
      const config = await project();
      const runs = await withDb(config, (db) => migrateDown(db, config.migrationsDir, Number(opts.steps)));
      if (!runs.length) return console.log('Nothing to revert');
      for (const r of runs) console.log(`  ${c.yellow('↓')} ${r.stream}/${r.name}`);
      console.log(
        c.yellow(
          '\n  The database is now behind migrations/_snapshot.json. Either re-run migrate:up, or delete the\n' +
            '  reverted migration file and revert the schema/snapshot change in git.',
        ),
      );
    }),
  );

program
  .command('migrate:status')
  .description('List migrations and whether they have been applied')
  .action(
    run(async () => {
      const config = await project();
      const rows = await withDb(config, (db) => migrationStatus(db, config.migrationsDir));
      for (const r of rows) {
        const mark = r.executedAt ? c.green('✓') : c.yellow('…');
        const when = r.executedAt ? c.dim(r.executedAt.toISOString()) : c.yellow('pending');
        console.log(`  ${mark} ${r.stream.padEnd(7)} ${r.name.padEnd(60)} ${when}`);
      }
    }),
  );

program
  .command('migrate:check')
  .description('CI check: fail if schema files changed without a migration or generated code is stale')
  .action(
    run(async () => {
      const config = await project();
      const r = await checkSchema(config);
      if (r.ok) return console.log(`${c.green('✓')} Schema, migrations and generated code are in sync`);
      for (const p of r.problems) console.error(`  ${c.red('✗')} ${p}`);
      process.exitCode = 1;
    }),
  );

program
  .command('content-type:add <apiId>')
  .description('Create a content type schema file, e.g. content-type:add article -f title:text:required:localizable')
  .option('-n, --display-name <name>', 'display name')
  .option('-f, --field <spec...>', 'field spec name:kind[:flags] (repeatable)', [])
  .option('--no-migration', 'only write the schema file')
  .action(
    run(async (apiId: string, opts: { displayName?: string; field: string[]; migration: boolean }) => {
      const config = await project();
      const existing = await loadDefinitions(config);
      if (existing.some((l) => l.def.apiId === apiId)) throw new Error(`Content type "${apiId}" already exists`);
      const def: ContentTypeDefinition = {
        id: newId('ct'),
        apiId,
        displayName: opts.displayName ?? apiId.charAt(0).toUpperCase() + apiId.slice(1),
        fields: opts.field.map(parseFieldSpec),
      };
      const { file } = await writeSchemaChange(config, { upsert: def });
      console.log(`${c.green('✓')} Wrote ${c.bold(rel(config, file!))}`);
      if (opts.migration) {
        const r = await createMigration(config);
        if (r.status === 'created') console.log(`${c.green('✓')} Created ${c.bold(rel(config, r.file))}`);
      }
    }),
  );

program
  .command('field:add <apiId> <spec...>')
  .description('Add field(s) to an existing content type, e.g. field:add product color:text:indexed')
  .option('--no-migration', 'only update the schema file')
  .action(
    run(async (apiId: string, specs: string[], opts: { migration: boolean }) => {
      const config = await project();
      const loaded = (await loadDefinitions(config)).find((l) => l.def.apiId === apiId);
      if (!loaded) throw new Error(`Content type "${apiId}" not found`);
      const def = { ...loaded.def, fields: [...loaded.def.fields, ...specs.map(parseFieldSpec)] };
      const { file } = await writeSchemaChange(config, { upsert: def });
      console.log(`${c.green('✓')} Updated ${c.bold(rel(config, file!))}`);
      if (opts.migration) {
        const r = await createMigration(config);
        if (r.status === 'created') console.log(`${c.green('✓')} Created ${c.bold(rel(config, r.file))}`);
      }
    }),
  );

program
  .command('dev')
  .description('Watch schema files: regenerate code, create and apply migrations on every change')
  .action(
    run(async () => {
      const config = await project();
      let timer: NodeJS.Timeout | undefined;
      let busy = false;
      const cycle = async () => {
        if (busy) return;
        busy = true;
        try {
          const r = await createMigration(config);
          if (r.status === 'created') {
            console.log(`${c.green('✓')} ${rel(config, r.file)}`);
            printPlan(r.plan.plan.summary, r.plan.plan.warnings);
          } else if (r.status === 'metadata-only') console.log(`${c.green('✓')} metadata updated`);
          const runs = await withDb(config, (db) => migrateUp(db, config.migrationsDir));
          for (const x of runs) console.log(`  ${c.green('↑')} ${x.stream}/${x.name}`);
        } catch (e) {
          if (e instanceof SchemaValidationError || e instanceof DiffError) e.issues.forEach((i) => console.error(c.red(`  - ${i}`)));
          else console.error(c.red((e as Error).message));
        } finally {
          busy = false;
        }
      };
      await cycle();
      console.log(c.dim(`Watching ${rel(config, config.contentTypesDir)} ...`));
      fs.mkdirSync(config.contentTypesDir, { recursive: true });
      fs.watch(config.contentTypesDir, { recursive: true }, () => {
        clearTimeout(timer);
        timer = setTimeout(cycle, 300);
      });
      await new Promise(() => undefined);
    }),
  );

if (require.main === module) program.parseAsync(process.argv);

export { program };
