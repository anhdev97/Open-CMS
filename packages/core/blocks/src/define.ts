import { validateLocalizedText, type BlockManifest } from '@opencloudcms/schema';
import { optionValue } from './fields';
import { COLOR_TOKENS, SPACING_TOKENS, type BlockDefinition, type BlockField, type BlockRegistry } from './types';

export const BLOCK_NAME_RE = /^[A-Z][A-Za-z0-9]{0,63}$/;
const FIELD_KEY_RE = /^[A-Za-z][A-Za-z0-9]*$/;
/** Prop names used by core or Puck on every item. */
const RESERVED_PROPS = ['id', '_v', 'puck', 'editMode'];

/** Typing helper: returns the definition unchanged. Validation happens in `defineBlocks`. */
export function defineBlock<F extends Record<string, BlockField>>(d: BlockDefinition<F>): BlockDefinition<F> {
  return d;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const show = (v: unknown) => JSON.stringify(v);

function validateLabel(v: unknown, where: string): string[] {
  if (v === undefined) return [];
  if (typeof v === 'string') return [];
  return validateLocalizedText(v, where);
}

function validateField(f: unknown, block: string, path: string): string[] {
  const where = `${block}: field "${path}"`;
  if (!isObj(f) || typeof f.kind !== 'string') return [`${where}: not a field (use b.*)`];
  const issues = validateLabel(f.label, `${where}: label`);
  const d = f.default;
  const bad = (expected: string) => issues.push(`${where}: default ${show(d)} is not ${expected}`);
  switch (f.kind) {
    case 'text':
    case 'longText':
    case 'richText':
      if (d !== undefined && typeof d !== 'string') bad('a string');
      break;
    case 'number':
      for (const k of ['min', 'max', 'step'] as const) {
        if (f[k] !== undefined && (typeof f[k] !== 'number' || !Number.isFinite(f[k]))) issues.push(`${where}: ${k} must be a number`);
      }
      if (d !== undefined) {
        if (typeof d !== 'number' || !Number.isFinite(d)) bad('a number');
        else if ((typeof f.min === 'number' && d < f.min) || (typeof f.max === 'number' && d > f.max)) bad('within min/max');
      }
      break;
    case 'boolean':
      if (d !== undefined && typeof d !== 'boolean') bad('a boolean');
      break;
    case 'select':
    case 'radio': {
      if (!Array.isArray(f.options) || f.options.length === 0) {
        issues.push(`${where}: options must be a non-empty array`);
        break;
      }
      const values = f.options.map((o) => optionValue(o as never));
      for (const [i, o] of (f.options as unknown[]).entries()) {
        const v = values[i];
        if (!['string', 'number', 'boolean'].includes(typeof v)) issues.push(`${where}: option ${i} has an invalid value`);
        if (isObj(o)) issues.push(...validateLabel(o.label ?? '', `${where}: option ${i} label`));
      }
      if (new Set(values).size !== values.length) issues.push(`${where}: options must be unique`);
      if (d !== undefined && !values.includes(d as never)) bad(`one of ${show(values)}`);
      break;
    }
    case 'color':
      if (d !== undefined && !(COLOR_TOKENS as readonly unknown[]).includes(d)) bad(`a color token (${COLOR_TOKENS.join(', ')})`);
      break;
    case 'spacing':
      if (d !== undefined && !(SPACING_TOKENS as readonly unknown[]).includes(d)) bad(`a spacing token (${SPACING_TOKENS.join(', ')})`);
      break;
    case 'link':
    case 'image':
      if (d !== undefined && d !== null && !isObj(d)) bad('an object or null');
      break;
    case 'entry':
    case 'entries':
      if (typeof f.apiId !== 'string' || (!f.apiId && !(f.kind === 'entries' && f.apiIdFrom))) issues.push(`${where}: apiId must be a non-empty string`);
      if (f.kind === 'entries' && f.limit !== undefined && !(Number.isInteger(f.limit) && (f.limit as number) > 0)) {
        issues.push(`${where}: limit must be a positive integer`);
      }
      break;
    case 'list':
      if (!isObj(f.fields)) issues.push(`${where}: list fields must be an object`);
      else issues.push(...validateFields(f.fields, block, path));
      if (d !== undefined && !Array.isArray(d)) bad('an array');
      break;
    case 'slot':
      if (f.allow !== undefined && (!Array.isArray(f.allow) || !f.allow.every((n) => typeof n === 'string'))) {
        issues.push(`${where}: allow must be an array of block names`);
      }
      if (f.max !== undefined && !(Number.isInteger(f.max) && (f.max as number) > 0)) issues.push(`${where}: max must be a positive integer`);
      break;
    default:
      issues.push(`${where}: unknown field kind "${String(f.kind)}"`);
  }
  return issues;
}

function validateFields(fields: Record<string, unknown>, block: string, prefix: string): string[] {
  const issues: string[] = [];
  for (const [key, f] of Object.entries(fields)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const at = `${block}: field "${path}"`;
    if (!FIELD_KEY_RE.test(key)) issues.push(`${at}: invalid field name`);
    else if (RESERVED_PROPS.includes(key)) issues.push(`${at}: "${key}" is reserved`);
    issues.push(...validateField(f, block, path));
  }
  return issues;
}

function validateBlock(d: unknown, index: number): string[] {
  if (!isObj(d)) return [`blocks[${index}]: not a block definition`];
  const name = typeof d.name === 'string' ? d.name : '';
  const where = `Block "${name || `#${index}`}"`;
  const issues: string[] = [];
  if (!BLOCK_NAME_RE.test(name)) issues.push(`${where}: name "${name}" must be PascalCase (${BLOCK_NAME_RE.source})`);
  if (d.label === undefined) issues.push(`${where}: label is required`);
  else issues.push(...validateLabel(d.label, `${where}: label`));
  if (typeof d.category !== 'string' || !d.category) issues.push(`${where}: category must be a non-empty string`);
  if (d.icon !== undefined && typeof d.icon !== 'string') issues.push(`${where}: icon must be a string`);
  const version = d.version ?? 1;
  if (!Number.isInteger(version) || (version as number) < 1) issues.push(`${where}: version must be a positive integer`);
  if (typeof d.render !== 'function') issues.push(`${where}: render must be a function`);
  if (!isObj(d.fields)) issues.push(`${where}: fields must be an object`);
  else issues.push(...validateFields(d.fields, where, ''));
  if (d.migrate !== undefined) {
    if (!Array.isArray(d.migrate)) issues.push(`${where}: migrate must be an array`);
    else {
      const froms = new Set<unknown>();
      for (const [i, m] of d.migrate.entries()) {
        const from = isObj(m) ? m.from : undefined;
        if (!isObj(m) || typeof m.up !== 'function') issues.push(`${where}: migrate[${i}].up must be a function`);
        if (!Number.isInteger(from) || (from as number) < 1 || (from as number) >= (version as number)) {
          issues.push(`${where}: migrate[${i}].from must be an integer from 1 to version - 1 (${(version as number) - 1})`);
        }
        if (froms.has(from)) issues.push(`${where}: migrate[${i}].from ${show(from)} is duplicated`);
        froms.add(from);
      }
    }
  }
  return issues;
}

/** Validates the project's blocks. Throws one Error listing every problem. */
export function defineBlocks(list: BlockDefinition<any>[]): BlockRegistry {
  if (!Array.isArray(list)) throw new Error('defineBlocks: expected an array of block definitions');
  const issues = list.flatMap((d, i) => validateBlock(d, i));
  const byName = new Map<string, BlockDefinition<any>>();
  for (const d of list) {
    if (!isObj(d) || typeof d.name !== 'string') continue;
    if (byName.has(d.name)) issues.push(`Block "${d.name}": duplicate name`);
    else byName.set(d.name, d);
  }
  if (issues.length) throw new Error(`Invalid blocks:\n- ${issues.join('\n- ')}`);
  const frozen = Object.freeze([...list]);
  return Object.freeze({
    list: frozen,
    get: (name: string) => byName.get(name),
    has: (name: string) => byName.has(name),
  });
}

/** `{ name, version }` of every block, for the server-side unknown-block check. */
export function blockManifest(r: BlockRegistry): BlockManifest {
  return r.list.map((d) => ({ name: d.name, version: d.version ?? 1 }));
}
