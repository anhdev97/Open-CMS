/**
 * Diff engine: compares the previous snapshot with the current definitions
 * (matching content types and fields by their stable `id`) and produces a
 * list of schema operations.
 */
import type { ContentTypeDefinition, FieldDefinition } from '@opencloudcms/schema';
import { fieldColumns, isMultiRelation } from '@opencloudcms/schema';

export type Operation =
  | { op: 'createType'; def: ContentTypeDefinition }
  | { op: 'dropType'; def: ContentTypeDefinition }
  | { op: 'renameType'; def: ContentTypeDefinition; toApiId: string }
  | { op: 'addField'; ctx: ContentTypeDefinition; field: FieldDefinition }
  | { op: 'dropField'; ctx: ContentTypeDefinition; field: FieldDefinition }
  | { op: 'renameField'; ctx: ContentTypeDefinition; from: FieldDefinition; to: FieldDefinition }
  | { op: 'alterField'; ctx: ContentTypeDefinition; from: FieldDefinition; to: FieldDefinition };

export class DiffError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Unsupported schema change:\n  - ${issues.join('\n  - ')}`);
    this.name = 'DiffError';
  }
}

export interface DiffResult {
  operations: Operation[];
  /** True when anything at all changed, including labels and other metadata. */
  changed: boolean;
}

const stable = (v: unknown) => JSON.stringify(v, Object.keys(flatKeys(v)).sort());
function flatKeys(v: unknown, acc: Record<string, true> = {}): Record<string, true> {
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      acc[k] = true;
      flatKeys(x, acc);
    }
  }
  return acc;
}
export const definitionsEqual = (a: unknown, b: unknown) => stable(a) === stable(b);

/** Parses `varchar(255)` / `numeric(18, 2)` into parts. */
function parseType(t: string): { base: string; args: number[] } {
  const m = /^([a-z ]+)(?:\((\d+)(?:, ?(\d+))?\))?$/.exec(t);
  if (!m) return { base: t, args: [] };
  return { base: m[1], args: [m[2], m[3]].filter((x) => x !== undefined).map(Number) };
}

/** Column type changes that never lose data. */
export function isSafeCast(from: string, to: string): boolean {
  if (from === to) return true;
  const a = parseType(from);
  const b = parseType(to);
  if (a.base === 'varchar' && b.base === 'varchar') return b.args[0] >= a.args[0];
  if (a.base === 'varchar' && b.base === 'text') return true;
  if (a.base === 'integer' && b.base === 'numeric') return b.args[0] - b.args[1] >= 10;
  if (a.base === 'numeric' && b.base === 'numeric') {
    return b.args[1] >= a.args[1] && b.args[0] - b.args[1] >= a.args[0] - a.args[1];
  }
  if (a.base === 'date' && b.base === 'timestamptz') return true;
  return false;
}

/** Only the properties that affect physical storage. */
function storageShape(field: FieldDefinition) {
  const o = field.options as Record<string, unknown>;
  return {
    multiple: isMultiRelation(field),
    localizable: field.localizable,
    kind: isMultiRelation(field) ? field.kind : undefined,
    taxonomyOrAssetTarget: field.kind === 'asset' || field.kind === 'taxonomy' ? field.kind : undefined,
    columns: isMultiRelation(field) ? [] : fieldColumns(field),
    indexed: field.indexed,
    unique: field.unique,
    ...(field.kind === 'reference' ? { referenceTarget: o.target } : {}),
  };
}

export function diffSchemas(prev: ContentTypeDefinition[], next: ContentTypeDefinition[]): DiffResult {
  const issues: string[] = [];
  const prevById = new Map(prev.map((d) => [d.id, d]));
  const nextById = new Map(next.map((d) => [d.id, d]));

  const drops: Operation[] = [];
  const renames: Operation[] = [];
  const creates: Operation[] = [];
  const fieldOps: Operation[] = [];

  for (const old of prev) {
    if (!nextById.has(old.id)) drops.push({ op: 'dropType', def: old });
  }

  for (const cur of next) {
    const old = prevById.get(cur.id);
    if (!old) {
      creates.push({ op: 'createType', def: cur });
      continue;
    }
    if (old.apiId !== cur.apiId) renames.push({ op: 'renameType', def: old, toApiId: cur.apiId });

    // Field ops run against a context whose table names already use the new apiId.
    const ctx: ContentTypeDefinition = { ...old, apiId: cur.apiId };
    const oldFields = new Map(old.fields.map((f) => [f.id, f]));
    const curFields = new Map(cur.fields.map((f) => [f.id, f]));

    const fRenames: Operation[] = [];
    const fAlters: Operation[] = [];
    const fDrops: Operation[] = [];
    const fAdds: Operation[] = [];

    for (const of of old.fields) {
      if (!curFields.has(of.id)) fDrops.push({ op: 'dropField', ctx, field: of });
    }
    for (const nf of cur.fields) {
      const of = oldFields.get(nf.id);
      if (!of) {
        fAdds.push({ op: 'addField', ctx, field: nf });
        continue;
      }
      let current = of;
      if (of.name !== nf.name) {
        const renamed = { ...of, name: nf.name };
        fRenames.push({ op: 'renameField', ctx, from: of, to: renamed });
        current = renamed;
      }
      const a = storageShape(current);
      const b = storageShape(nf);
      if (definitionsEqual(a, b)) continue;

      const at = `${cur.apiId}.${nf.name}`;
      if (a.multiple !== b.multiple) {
        issues.push(`${at}: switching between single and multiple is not supported. Add a new field and migrate the data.`);
        continue;
      }
      if (a.localizable !== b.localizable) {
        issues.push(`${at}: changing "localizable" on an existing field is not supported yet. Add a new field and migrate the data.`);
        continue;
      }
      if (a.multiple && a.kind !== b.kind) {
        issues.push(`${at}: changing kind of a multiple relation is not supported.`);
        continue;
      }
      if (!a.multiple) {
        const ca = a.columns;
        const cb = b.columns;
        const sameNames = ca.length === cb.length && ca.every((c, i) => c.name === cb[i].name);
        if (!sameNames) {
          issues.push(`${at}: changing kind "${current.kind}" -> "${nf.kind}" changes the storage layout. Add a new field instead.`);
          continue;
        }
        const unsafe = ca.find((c, i) => !isSafeCast(c.type, cb[i].type));
        if (unsafe) {
          const target = cb[ca.indexOf(unsafe)].type;
          issues.push(`${at}: column type ${unsafe.type} -> ${target} may lose data. Only widening changes are generated automatically.`);
          continue;
        }
      }
      fAlters.push({ op: 'alterField', ctx, from: current, to: nf });
    }
    fieldOps.push(...fRenames, ...fAlters, ...fDrops, ...fAdds);
  }

  if (issues.length) throw new DiffError(issues);
  const operations = [...drops, ...renames, ...creates, ...fieldOps];
  const changed = operations.length > 0 || !definitionsEqual(sortById(prev), sortById(next));
  return { operations, changed };
}

const sortById = (defs: ContentTypeDefinition[]) => [...defs].sort((a, b) => a.id.localeCompare(b.id));
