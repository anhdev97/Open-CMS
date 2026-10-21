import { fieldColumns, isMultiRelation, snake } from './physical';
import { GROUP_KEY_RE, validateLocalizedText } from './groups';
import type { ContentTypeDefinition, FieldKind } from './types';

export const FIELD_KINDS: FieldKind[] = [
  'text', 'longText', 'richText', 'slug', 'email', 'url', 'number', 'boolean',
  'date', 'datetime', 'json', 'money', 'asset', 'reference', 'taxonomy',
];

export const RESERVED_FIELD_NAMES = new Set([
  'id', 'documentId', 'status', 'locale', 'createdAt', 'updatedAt', 'publishedAt', 'entryId',
]);

const API_ID_RE = /^[a-z][a-zA-Z0-9]{0,39}$/;
const FIELD_NAME_RE = /^[a-z][a-zA-Z0-9]{0,49}$/;
const STABLE_ID_RE = /^[a-zA-Z0-9_]{1,64}$/;

export class SchemaValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid content type definitions:\n  - ${issues.join('\n  - ')}`);
    this.name = 'SchemaValidationError';
  }
}

/** Returns a list of problems; empty when every definition is valid. */
export function collectSchemaIssues(defs: ContentTypeDefinition[]): string[] {
  const issues: string[] = [];
  const typeIds = new Set<string>();
  const apiIds = new Set(defs.map((d) => d.apiId));
  const seenApiIds = new Set<string>();

  for (const def of defs) {
    const where = `content type "${def.apiId}"`;
    if (!STABLE_ID_RE.test(def.id ?? '')) issues.push(`${where}: id "${def.id}" must match ${STABLE_ID_RE}`);
    if (typeIds.has(def.id)) issues.push(`${where}: duplicate content type id "${def.id}"`);
    typeIds.add(def.id);
    if (!API_ID_RE.test(def.apiId ?? '')) issues.push(`${where}: apiId must be camelCase (${API_ID_RE})`);
    if (seenApiIds.has(def.apiId)) issues.push(`${where}: duplicate apiId`);
    seenApiIds.add(def.apiId);
    if (!def.displayName) issues.push(`${where}: displayName is required`);
    else if (typeof def.displayName !== 'string') issues.push(...validateLocalizedText(def.displayName, `${where}: displayName`));
    if (def.group !== undefined && (typeof def.group !== 'string' || !GROUP_KEY_RE.test(def.group))) {
      issues.push(`${where}: group must match ${GROUP_KEY_RE}`);
    }

    const fieldIds = new Set<string>();
    const fieldNames = new Set<string>();
    const columns = new Map<string, string>(); // "main:col" -> field

    for (const field of def.fields) {
      const at = `${where}, field "${field.name}"`;
      if (!FIELD_NAME_RE.test(field.name ?? '')) issues.push(`${at}: name must be camelCase (${FIELD_NAME_RE})`);
      if (RESERVED_FIELD_NAMES.has(field.name)) issues.push(`${at}: "${field.name}" is reserved`);
      if (fieldNames.has(field.name)) issues.push(`${at}: duplicate field name`);
      fieldNames.add(field.name);
      if (!STABLE_ID_RE.test(field.id ?? '')) issues.push(`${at}: id "${field.id}" must match ${STABLE_ID_RE}`);
      if (fieldIds.has(field.id)) issues.push(`${at}: duplicate field id "${field.id}"`);
      fieldIds.add(field.id);
      if (!FIELD_KINDS.includes(field.kind)) {
        issues.push(`${at}: unknown kind "${field.kind}"`);
        continue;
      }
      const o = field.options as Record<string, any>;

      if (isMultiRelation(field)) {
        if (field.localizable) issues.push(`${at}: multiple relations cannot be localizable`);
        if (field.unique) issues.push(`${at}: multiple relations cannot be unique`);
      } else {
        for (const col of fieldColumns(field)) {
          const key = `${field.localizable ? 'l10n' : 'main'}:${col.name}`;
          if (columns.has(key)) issues.push(`${at}: column "${col.name}" collides with field "${columns.get(key)}"`);
          columns.set(key, field.name);
        }
      }
      if (field.unique && ['money', 'json', 'richText', 'boolean'].includes(field.kind)) {
        issues.push(`${at}: ${field.kind} fields cannot be unique`);
      }
      if (field.indexed && ['json', 'richText'].includes(field.kind)) {
        issues.push(`${at}: ${field.kind} fields cannot be indexed`);
      }
      if ((field.kind === 'text' || field.kind === 'slug') && o.maxLength !== undefined) {
        if (!Number.isInteger(o.maxLength) || o.maxLength < 1 || o.maxLength > 10000) {
          issues.push(`${at}: maxLength must be an integer between 1 and 10000`);
        }
      }
      if (field.kind === 'number' && o.format === 'decimal') {
        const p = o.precision ?? 18;
        const s = o.scale ?? 2;
        if (!Number.isInteger(p) || !Number.isInteger(s) || p < 1 || p > 38 || s < 0 || s > p) {
          issues.push(`${at}: decimal precision/scale must satisfy 1 <= precision <= 38, 0 <= scale <= precision`);
        }
      }
      if (field.kind === 'reference') {
        if (!o.target) issues.push(`${at}: reference requires a "target" content type apiId`);
        else if (!apiIds.has(o.target)) issues.push(`${at}: reference target "${o.target}" does not exist`);
      }
      if (field.kind === 'taxonomy' && !o.taxonomy) issues.push(`${at}: taxonomy requires a "taxonomy" slug`);
      if (field.kind === 'money' && o.currencyMode === 'fixed' && !/^[A-Z]{3}$/.test(o.currency ?? '')) {
        issues.push(`${at}: fixed currency must be an ISO 4217 code such as "VND"`);
      }
      if (field.kind === 'slug' && o.from && !def.fields.some((x) => x.name === o.from)) {
        issues.push(`${at}: slug source field "${o.from}" does not exist`);
      }
    }
    if (snake(def.apiId).length > 40) issues.push(`${where}: apiId is too long`);
  }
  return issues;
}

export function assertValidSchema(defs: ContentTypeDefinition[]): void {
  const issues = collectSchemaIssues(defs);
  if (issues.length) throw new SchemaValidationError(issues);
}
