/**
 * Print, load and index composed (builder-made) block files:
 * `src/blocks/<kebab>/<kebab>.block.ts` plus the managed `src/blocks/composed.ts`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createJiti } from 'jiti';
import type { ComposedBlockSpec, ResolvedConfig } from '@opencloudcms/schema';
import { validateComposedSpec, type ComposedIssue } from '@opencloudcms/schema';

const NAME_RE = /^[A-Z][A-Za-z0-9]{0,63}$/;

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const MAX_INLINE = 90;

const SPEC_ORDER = ['id', 'name', 'label', 'category', 'icon', 'version', 'binding', 'fields', 'tree'];
const BINDING_ORDER = ['apiId', 'mode', 'filter', 'sort', 'limit', 'layout', 'urlPattern', 'options'];
const NODE_ORDER = ['el', 'props', 'bind', 'showIf', 'children'];

const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`;
const key = (k: string) => (IDENT.test(k) ? k : q(k));

type Ordered = unknown;

function ordered(obj: Record<string, unknown>, order: string[]): [string, unknown][] {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
  const rank = (k: string) => {
    const i = order.indexOf(k);
    return i < 0 ? order.length : i;
  };
  // stable: known keys by fixed order, unknown keys keep insertion order after them
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => rank(a.e[0]) - rank(b.e[0]) || a.i - b.i)
    .map((x) => x.e);
}

function inline(v: Ordered): string | null {
  if (v === null) return 'null';
  if (typeof v === 'string') return q(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    const parts = v.map(inline);
    return parts.some((p) => p === null) ? null : `[${parts.join(', ')}]`;
  }
  if (typeof v === 'object') return null; // objects are decided by pp
  throw new Error(`Cannot print value of type ${typeof v}`);
}

/** Pretty printer: objects/arrays go on one line when they are short and flat, else one entry per line. */
function pp(v: unknown, indent: string, order?: (path: string[]) => string[], p: string[] = []): string {
  if (Array.isArray(v)) {
    const flat = inline(v);
    if (flat !== null && flat.length <= MAX_INLINE) return flat;
    if (!v.length) return '[]';
    const inner = indent + '  ';
    return `[\n${v.map((x) => `${inner}${pp(x, inner, order, [...p, '[]'])},`).join('\n')}\n${indent}]`;
  }
  if (v && typeof v === 'object') {
    const entries = ordered(v as Record<string, unknown>, order ? order(p) : []);
    if (!entries.length) return '{}';
    const flatParts = entries.map(([k, x]) => {
      const f = x && typeof x === 'object' && !Array.isArray(x) ? flatObject(x as Record<string, unknown>, order, [...p, k]) : inline(x);
      return f === null ? null : `${key(k)}: ${f}`;
    });
    if (!flatParts.some((x) => x === null)) {
      const flat = `{ ${flatParts.join(', ')} }`;
      if (flat.length <= MAX_INLINE) return flat;
    }
    const inner = indent + '  ';
    return `{\n${entries.map(([k, x]) => `${inner}${key(k)}: ${pp(x, inner, order, [...p, k])},`).join('\n')}\n${indent}}`;
  }
  const s = inline(v);
  if (s === null) throw new Error('Cannot print value');
  return s;
}

function flatObject(o: Record<string, unknown>, order: ((p: string[]) => string[]) | undefined, p: string[]): string | null {
  const entries = ordered(o, order ? order(p) : []);
  if (!entries.length) return '{}';
  const parts: string[] = [];
  for (const [k, x] of entries) {
    const f = x && typeof x === 'object' && !Array.isArray(x) ? flatObject(x as Record<string, unknown>, order, [...p, k]) : inline(x);
    if (f === null) return null;
    parts.push(`${key(k)}: ${f}`);
  }
  return `{ ${parts.join(', ')} }`;
}

/** A JS literal for a JSON-like value (single-quoted strings; short flat objects/arrays on one line). */
export function printLiteral(v: unknown, indent = ''): string {
  return pp(v, indent);
}

/** Key order by position in the spec: top level, `binding`, and tree nodes. */
function orderFor(p: string[]): string[] {
  if (p.length === 0) return SPEC_ORDER;
  if (p.length === 1 && p[0] === 'binding') return BINDING_ORDER;
  if (p[0] === 'tree') {
    // tree, tree.children.[] , tree.children.[].children.[] ... are nodes
    const rest = p.slice(1);
    const isNode = rest.every((s, i) => (i % 2 === 0 ? s === 'children' : s === '[]'));
    if (isNode && rest.length % 2 === 0) return NODE_ORDER;
  }
  return [];
}

export function kebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

export function blocksDir(config: ResolvedConfig): string {
  return path.join(config.root, 'src', 'blocks');
}

export function composedBlockFile(config: ResolvedConfig, name: string): string {
  const k = kebab(name);
  return path.join(blocksDir(config), k, `${k}.block.ts`);
}

function composedIndexFile(config: ResolvedConfig): string {
  return path.join(blocksDir(config), 'composed.ts');
}

export function printComposedBlockFile(spec: ComposedBlockSpec): string {
  return [
    '// Composed block. Managed by OpenCloudCMS: edit by hand or from the admin',
    '// Block Builder (which rewrites this file).',
    "import { defineComposedBlock } from '@opencloudcms/core/blocks';",
    '',
    `export default defineComposedBlock(${pp(spec, '', orderFor)});`,
    '',
  ].join('\n');
}

export function printComposedIndex(entries: { name: string; importPath: string }[]): string {
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const id = (e: { name: string }) => `block${e.name}`;
  return [
    '// Index of composed blocks. Managed by OpenCloudCMS: rewritten by the admin',
    '// Block Builder. Spread `composedBlocks` into src/blocks/index.ts.',
    ...sorted.map((e) => `import ${id(e)} from ${q(e.importPath)};`),
    '',
    `export const composedBlocks = [${sorted.map(id).join(', ')}];`,
    '',
  ].join('\n');
}

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.block\.(ts|js)$/.test(e.name) ? [p] : [];
  });
}

function blockJiti(root: string) {
  // Never load React or the real blocks package: composed block files only need the identity helper.
  return createJiti(path.join(root, 'noop.js'), {
    moduleCache: false,
    fsCache: false,
    interopDefault: true,
    virtualModules: { '@opencloudcms/core/blocks': { defineComposedBlock: (s: unknown) => s } },
  });
}

export async function loadComposedBlocks(
  config: ResolvedConfig,
): Promise<{ specs: { spec: ComposedBlockSpec; file: string }[]; errors: { file: string; message: string }[] }> {
  const specs: { spec: ComposedBlockSpec; file: string }[] = [];
  const errors: { file: string; message: string }[] = [];
  const jiti = blockJiti(config.root);
  for (const file of walk(blocksDir(config)).sort()) {
    let source: string;
    try {
      source = fs.readFileSync(file, 'utf8');
    } catch (e) {
      errors.push({ file, message: (e as Error).message });
      continue;
    }
    if (!source.includes('defineComposedBlock')) continue;
    try {
      const mod = await jiti.import<unknown>(file, { default: true });
      const issues = validateComposedSpec(mod);
      if (issues.length) {
        errors.push({ file, message: issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ') });
        continue;
      }
      specs.push({ spec: mod as ComposedBlockSpec, file });
    } catch (e) {
      errors.push({ file, message: (e as Error).message });
    }
  }
  // Two files declaring the same block name are ambiguous: report both instead of picking one.
  const byName = new Map<string, { spec: ComposedBlockSpec; file: string }[]>();
  for (const s of specs) byName.set(s.spec.name, [...(byName.get(s.spec.name) ?? []), s]);
  const dupes = new Set<string>();
  for (const [name, list] of byName) {
    if (list.length < 2) continue;
    for (const s of list) {
      dupes.add(s.file);
      errors.push({ file: s.file, message: `Duplicate block name "${name}" (also declared in ${list.filter((o) => o !== s).map((o) => o.file).join(', ')})` });
    }
  }
  return { specs: specs.filter((s) => !dupes.has(s.file)), errors };
}

/** True when `src/blocks/index.ts` imports `composedBlocks` (the builder never edits that file). */
export function isComposedIndexWired(config: ResolvedConfig): boolean {
  const file = path.join(blocksDir(config), 'index.ts');
  if (!fs.existsSync(file)) return false;
  return /\bcomposedBlocks\b/.test(fs.readFileSync(file, 'utf8'));
}

/** Thrown by `writeComposedBlocks` when other composed block files are broken (nothing is written). */
export class ComposedBlocksLoadError extends Error {
  constructor(public readonly errors: { file: string; message: string }[]) {
    super(`Composed block files are invalid: ${errors.map((e) => `${e.file}: ${e.message}`).join('; ')}`);
    this.name = 'ComposedBlocksLoadError';
  }
}

/** Thrown when the spec to upsert is invalid or the name to remove is not a valid block name. */
export class ComposedBlockInvalidError extends Error {
  constructor(public readonly issues: ComposedIssue[]) {
    super(`Invalid composed block: ${issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
    this.name = 'ComposedBlockInvalidError';
  }
}

/** Thrown when the target file of an upsert is already owned by a different block name (kebab-case collision). */
export class ComposedBlockConflictError extends Error {
  constructor(public readonly name: string, public readonly file: string, public readonly ownerName: string) {
    super(`Block "${name}" would write ${file}, which belongs to block "${ownerName}"`);
    this.name = 'ComposedBlockConflictError';
  }
}

function assertInside(config: ResolvedConfig, file: string): void {
  const rel = path.relative(blocksDir(config), path.resolve(file));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`Refusing to touch ${file}: outside ${blocksDir(config)}`);
}

/**
 * Upserts / removes one composed block file and regenerates `composed.ts`. Returns the paths written or removed.
 * Does not snapshot; callers wrap it with captureProjectFiles/restoreProjectFiles if they need rollback.
 * Throws ComposedBlockInvalidError, ComposedBlocksLoadError (another block file is broken) or
 * ComposedBlockConflictError before writing anything.
 */
export async function writeComposedBlocks(
  config: ResolvedConfig,
  change: { upsert?: ComposedBlockSpec; removeName?: string },
): Promise<string[]> {
  if (change.removeName !== undefined && !NAME_RE.test(change.removeName)) {
    throw new ComposedBlockInvalidError([{ path: ['name'], message: 'name must be PascalCase (^[A-Z][A-Za-z0-9]{0,63}$)' }]);
  }
  if (change.upsert) {
    const issues = validateComposedSpec(change.upsert);
    if (issues.length) throw new ComposedBlockInvalidError(issues);
  }
  const { specs, errors } = await loadComposedBlocks(config);
  // A broken file of the block being written or removed may be replaced; any other broken file blocks the write
  // (it would silently vanish from composed.ts and break pages that use it).
  const own = new Set<string>();
  for (const n of [change.upsert?.name, change.removeName]) if (n) own.add(composedBlockFile(config, n));
  const blocking = errors.filter((e) => !own.has(e.file));
  if (blocking.length) throw new ComposedBlocksLoadError(blocking);

  const byName = new Map(specs.map((s) => [s.spec.name, s]));
  let removeFile: string | undefined;
  let upsertFile: string | undefined;
  if (change.removeName) {
    removeFile = byName.get(change.removeName)?.file ?? composedBlockFile(config, change.removeName);
    assertInside(config, removeFile);
  }
  if (change.upsert) {
    const spec = change.upsert;
    const target = composedBlockFile(config, spec.name);
    const owner = specs.find((s) => s.file === target && s.spec.name !== spec.name);
    if (owner) throw new ComposedBlockConflictError(spec.name, target, owner.spec.name);
    upsertFile = byName.get(spec.name)?.file ?? target;
    assertInside(config, upsertFile);
  }

  const touched: string[] = [];
  if (change.removeName && removeFile) {
    if (fs.existsSync(removeFile)) {
      fs.rmSync(removeFile);
      touched.push(removeFile);
      // Only the block's own folder (src/blocks/<kebab>), and only when it is now empty.
      const folder = path.dirname(removeFile);
      if (folder === path.join(blocksDir(config), kebab(change.removeName)) && !fs.readdirSync(folder).length) {
        fs.rmdirSync(folder);
        touched.push(folder);
      }
    }
    byName.delete(change.removeName);
  }

  if (change.upsert && upsertFile) {
    fs.mkdirSync(path.dirname(upsertFile), { recursive: true });
    fs.writeFileSync(upsertFile, printComposedBlockFile(change.upsert));
    touched.push(upsertFile);
    byName.set(change.upsert.name, { spec: change.upsert, file: upsertFile });
  }

  const dir = blocksDir(config);
  const entries = [...byName.values()].map(({ spec, file }) => {
    const rel = path.relative(dir, file).split(path.sep).join('/').replace(/\.(ts|js)$/, '');
    return { name: spec.name, importPath: rel.startsWith('.') ? rel : `./${rel}` };
  });
  const indexFile = composedIndexFile(config);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(indexFile, printComposedIndex(entries));
  touched.push(indexFile);
  return touched;
}
