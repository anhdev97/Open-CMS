import * as fs from 'node:fs';
import * as path from 'node:path';
import { createJiti } from 'jiti';
import type { ContentGroupDefinition, ContentTypeDefinition, OpenCloudCmsConfig, ResolvedConfig, ThemeDefinition } from '@opencloudcms/schema';
import { CONFIG_FILE_NAMES, RESERVED_API_IDS, normalizeDefinition, resolveConfig, validateTheme } from '@opencloudcms/schema';

function freshJiti(root: string) {
  // No caches: the admin UI rewrites schema files while the process is running.
  return createJiti(path.join(root, 'noop.js'), { moduleCache: false, fsCache: false, interopDefault: true });
}

export function findProjectRoot(start = process.cwd()): string {
  let dir = path.resolve(start);
  for (;;) {
    if (CONFIG_FILE_NAMES.some((n) => fs.existsSync(path.join(dir, n)))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`No opencloudcms.config.ts found in ${start} or any parent directory.`);
    dir = parent;
  }
}

export async function loadConfig(root: string): Promise<ResolvedConfig> {
  const file = CONFIG_FILE_NAMES.map((n) => path.join(root, n)).find((p) => fs.existsSync(p));
  if (!file) throw new Error(`No opencloudcms.config.ts in ${root}`);
  const config = await freshJiti(root).import<OpenCloudCmsConfig>(file, { default: true });
  return resolveConfig(config, root);
}

export function contentGroupsFile(config: ResolvedConfig): string {
  return path.join(config.root, 'src', 'content-groups.ts');
}

export function localesFile(config: ResolvedConfig): string {
  return path.join(config.root, 'src', 'locales.ts');
}

export function themeFile(config: ResolvedConfig): string {
  return path.join(config.root, 'src', 'theme.ts');
}

/** Loads `src/theme.ts`; a missing file means no theme. An invalid theme throws with the issue list. */
export async function loadTheme(config: ResolvedConfig): Promise<ThemeDefinition | null> {
  const file = themeFile(config);
  if (!fs.existsSync(file)) return null;
  const mod = await freshJiti(config.root).import<ThemeDefinition>(file, { default: true });
  const issues = validateTheme(mod);
  if (issues.length) {
    throw new Error(`Invalid ${path.relative(config.root, file)}: ${issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
  }
  return mod;
}

/** Loads `src/content-groups.ts`; a missing file means no groups. */
export async function loadContentGroups(config: ResolvedConfig): Promise<ContentGroupDefinition[]> {
  const file = contentGroupsFile(config);
  if (!fs.existsSync(file)) return [];
  const mod = await freshJiti(config.root).import<ContentGroupDefinition[]>(file, { default: true });
  if (!Array.isArray(mod)) {
    throw new Error(`${path.relative(config.root, file)} must \`export default defineContentGroups([...])\``);
  }
  return mod;
}

export interface LoadedDefinition {
  def: ContentTypeDefinition;
  file: string;
}

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.schema\.(ts|js)$/.test(e.name) ? [p] : [];
  });
}

/** Reserved apiIds (core-owned types such as the page type, and `assets`) cannot be defined by a project. */
export function assertNoCoreApiIds(defs: Pick<ContentTypeDefinition, 'apiId'>[]): void {
  for (const d of defs) {
    if (RESERVED_API_IDS.includes(d.apiId)) throw new Error(`apiId "${d.apiId}" is reserved by OpenCloudCMS`);
  }
}

export async function loadDefinitions(config: ResolvedConfig): Promise<LoadedDefinition[]> {
  const jiti = freshJiti(config.root);
  const out: LoadedDefinition[] = [];
  for (const file of walk(config.contentTypesDir).sort()) {
    const mod = await jiti.import<ContentTypeDefinition>(file, { default: true });
    if (!mod || typeof mod !== 'object' || !('apiId' in mod)) {
      throw new Error(`${path.relative(config.root, file)} must \`export default defineContentType({...})\``);
    }
    const def = normalizeDefinition(mod);
    assertNoCoreApiIds([def]);
    out.push({ def, file });
  }
  return out;
}
