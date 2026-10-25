/**
 * Turns diff operations into reversible DDL statements.
 *
 * Destructive changes are "soft": dropping a field or a content type renames
 * the column / tables to `_del<stamp>_<name>` instead of dropping them, so
 * `migrate:down` restores data and nothing is lost by accident.
 */
import type { ContentTypeDefinition, FieldDefinition } from '@opencloudcms/schema';
import {
  documentStatusIndexName,
  fieldIndex,
  fieldStorage,
  isMultiRelation,
  l10nBaseColumns,
  l10nPkeyName,
  l10nTable,
  mainBaseColumns,
  mainPkeyName,
  mainTable,
  pgName,
  relBaseColumns,
  relPkeyName,
  relTable,
  relTargetIndexName,
  typeIndexNames,
  typeTableNames,
} from '@opencloudcms/schema';
import type { Operation } from './diff';
import type { Statement } from './ddl';

export interface MigrationPlan {
  up: Statement[];
  down: Statement[];
  warnings: string[];
  summary: string[];
}

interface Step {
  up: Statement[];
  down: Statement[];
}

const archived = (stamp: string, name: string) => pgName(`_del${stamp}_${name}`);

function relationTableSteps(def: ContentTypeDefinition, field: FieldDefinition): Step {
  const table = relTable(def, field);
  return {
    up: [
      { type: 'createTable', table, columns: relBaseColumns(def, field), primaryKey: { name: relPkeyName(def, field), columns: ['entry_id', 'target_id'] } },
      { type: 'createIndex', index: { name: relTargetIndexName(def, field), table, columns: ['target_id'], unique: false } },
    ],
    down: [{ type: 'dropTable', table }],
  };
}

function createType(def: ContentTypeDefinition): Step {
  const main = mainTable(def);
  const l10n = l10nTable(def);
  const mainCols = [...mainBaseColumns()];
  const l10nCols = [...l10nBaseColumns(def)];
  const up: Statement[] = [];
  const down: Statement[] = [];
  const rel: Step[] = [];

  for (const field of def.fields) {
    const s = fieldStorage(def, field);
    if (s.mode === 'columns') (s.location === 'main' ? mainCols : l10nCols).push(...s.columns);
    else rel.push(relationTableSteps(def, field));
  }
  up.push({ type: 'createTable', table: main, columns: mainCols, primaryKey: { name: mainPkeyName(def), columns: ['id'] } });
  up.push({ type: 'createIndex', index: { name: documentStatusIndexName(def), table: main, columns: ['document_id', 'status'], unique: true } });
  up.push({ type: 'createTable', table: l10n, columns: l10nCols, primaryKey: { name: l10nPkeyName(def), columns: ['entry_id', 'locale'] } });
  for (const r of rel) up.push(...r.up);
  for (const field of def.fields) {
    const idx = fieldIndex(def, field);
    if (idx) up.push({ type: 'createIndex', index: idx });
  }
  for (const r of [...rel].reverse()) down.push(...r.down);
  down.push({ type: 'dropTable', table: l10n }, { type: 'dropTable', table: main });
  return { up, down };
}

function renamePairs(fromNames: string[], toNames: string[], kind: 'table' | 'index'): Step {
  const up: Statement[] = [];
  const down: Statement[] = [];
  fromNames.forEach((from, i) => {
    const to = toNames[i];
    if (from === to) return;
    if (kind === 'table') {
      up.push({ type: 'renameTable', from, to });
      down.unshift({ type: 'renameTable', from: to, to: from });
    } else {
      up.push({ type: 'renameIndex', from, to });
      down.unshift({ type: 'renameIndex', from: to, to: from });
    }
  });
  return { up, down };
}

function merge(...steps: Step[]): Step {
  // up runs in order; down runs in reverse order of steps.
  return { up: steps.flatMap((s) => s.up), down: [...steps].reverse().flatMap((s) => s.down) };
}

function renameType(def: ContentTypeDefinition, toApiId: string): Step {
  const next = { ...def, apiId: toApiId };
  return merge(
    renamePairs(typeTableNames(def), typeTableNames(next), 'table'),
    renamePairs(typeIndexNames(def), typeIndexNames(next), 'index'),
  );
}

function dropType(def: ContentTypeDefinition, stamp: string): Step {
  const tables = typeTableNames(def);
  const indexes = typeIndexNames(def);
  return merge(
    renamePairs(tables, tables.map((t) => archived(stamp, t)), 'table'),
    renamePairs(indexes, indexes.map((i) => archived(stamp, i)), 'index'),
  );
}

function addField(ctx: ContentTypeDefinition, field: FieldDefinition): Step {
  const s = fieldStorage(ctx, field);
  if (s.mode === 'relation') return relationTableSteps(ctx, field);
  const up: Statement[] = s.columns.map((column) => ({ type: 'addColumn', table: s.table, column }));
  const down: Statement[] = s.columns.map((c) => ({ type: 'dropColumn', table: s.table, column: c.name })).reverse() as Statement[];
  const idx = fieldIndex(ctx, field);
  if (idx) {
    up.push({ type: 'createIndex', index: idx });
    down.unshift({ type: 'dropIndex', name: idx.name });
  }
  return { up, down };
}

function dropField(ctx: ContentTypeDefinition, field: FieldDefinition, stamp: string): Step {
  const s = fieldStorage(ctx, field);
  if (s.mode === 'relation') {
    const idx = [relPkeyName(ctx, field), relTargetIndexName(ctx, field)];
    return merge(
      renamePairs([s.table], [archived(stamp, s.table)], 'table'),
      renamePairs(idx, idx.map((i) => archived(stamp, i)), 'index'),
    );
  }
  const up: Statement[] = [];
  const down: Statement[] = [];
  const idx = fieldIndex(ctx, field);
  if (idx) {
    up.push({ type: 'dropIndex', name: idx.name });
  }
  for (const c of s.columns) {
    const to = archived(stamp, c.name);
    up.push({ type: 'renameColumn', table: s.table, from: c.name, to });
    down.unshift({ type: 'renameColumn', table: s.table, from: to, to: c.name });
  }
  if (idx) down.push({ type: 'createIndex', index: idx });
  return { up, down };
}

function renameField(ctx: ContentTypeDefinition, from: FieldDefinition, to: FieldDefinition): Step {
  const a = fieldStorage(ctx, from);
  const b = fieldStorage(ctx, to);
  if (a.mode === 'relation' && b.mode === 'relation') {
    return merge(
      renamePairs([a.table], [b.table], 'table'),
      renamePairs([relPkeyName(ctx, from), relTargetIndexName(ctx, from)], [relPkeyName(ctx, to), relTargetIndexName(ctx, to)], 'index'),
    );
  }
  if (a.mode !== 'columns' || b.mode !== 'columns') throw new Error('unreachable');
  const up: Statement[] = [];
  const down: Statement[] = [];
  a.columns.forEach((c, i) => {
    const target = b.columns[i].name;
    if (c.name === target) return;
    up.push({ type: 'renameColumn', table: a.table, from: c.name, to: target });
    down.unshift({ type: 'renameColumn', table: a.table, from: target, to: c.name });
  });
  const ia = fieldIndex(ctx, from);
  const ib = fieldIndex(ctx, to);
  const idx = ia && ib ? renamePairs([ia.name], [ib.name], 'index') : { up: [], down: [] };
  return merge({ up, down }, idx);
}

function alterField(ctx: ContentTypeDefinition, from: FieldDefinition, to: FieldDefinition, warnings: string[]): Step {
  const a = fieldStorage(ctx, from);
  const b = fieldStorage(ctx, to);
  if (a.mode !== 'columns' || b.mode !== 'columns') return { up: [], down: [] }; // relation target change: no DDL
  const ia = fieldIndex(ctx, from);
  const ib = fieldIndex(ctx, to);
  const indexChanged = JSON.stringify(ia) !== JSON.stringify(ib);

  const dropOld: Step = ia && indexChanged
    ? { up: [{ type: 'dropIndex', name: ia.name }], down: [{ type: 'createIndex', index: ia }] }
    : { up: [], down: [] };
  const alter: Step = { up: [], down: [] };
  a.columns.forEach((c, i) => {
    const t = b.columns[i].type;
    if (c.type === t) return;
    alter.up.push({ type: 'alterColumnType', table: a.table, column: c.name, toType: t });
    alter.down.unshift({ type: 'alterColumnType', table: a.table, column: c.name, toType: c.type });
    warnings.push(`${ctx.apiId}.${to.name}: column ${c.name} widened ${c.type} -> ${t} (rollback may fail if longer values were saved).`);
  });
  const createNew: Step = ib && indexChanged
    ? { up: [{ type: 'createIndex', index: ib }], down: [{ type: 'dropIndex', name: ib.name }] }
    : { up: [], down: [] };
  if (ib?.unique && !ia?.unique) {
    warnings.push(`${ctx.apiId}.${to.name}: adding a unique index fails if existing entries contain duplicates.`);
  }
  return merge(dropOld, alter, createNew);
}

export function planMigration(operations: Operation[], stamp: string): MigrationPlan {
  const warnings: string[] = [];
  const summary: string[] = [];
  const steps: Step[] = [];

  for (const op of operations) {
    switch (op.op) {
      case 'createType':
        summary.push(`create content type "${op.def.apiId}"`);
        steps.push(createType(op.def));
        break;
      case 'dropType':
        summary.push(`archive content type "${op.def.apiId}"`);
        warnings.push(`Content type "${op.def.apiId}" is archived: its tables are renamed with prefix _del${stamp}_ (data kept, drop them manually when sure).`);
        steps.push(dropType(op.def, stamp));
        break;
      case 'renameType':
        summary.push(`rename content type "${op.def.apiId}" -> "${op.toApiId}"`);
        warnings.push(`REST path changes from /${op.def.apiId} to /${op.toApiId}; update API clients.`);
        steps.push(renameType(op.def, op.toApiId));
        break;
      case 'addField':
        summary.push(`add field ${op.ctx.apiId}.${op.field.name} (${op.field.kind})`);
        if (op.field.required) {
          warnings.push(`${op.ctx.apiId}.${op.field.name} is required: existing entries must be filled in before they can be re-published.`);
        }
        steps.push(addField(op.ctx, op.field));
        break;
      case 'dropField':
        summary.push(`archive field ${op.ctx.apiId}.${op.field.name}`);
        warnings.push(`${op.ctx.apiId}.${op.field.name} is archived (column renamed with prefix _del${stamp}_, data kept).`);
        steps.push(dropField(op.ctx, op.field, stamp));
        break;
      case 'renameField':
        summary.push(`rename field ${op.ctx.apiId}.${op.from.name} -> ${op.to.name}`);
        steps.push(renameField(op.ctx, op.from, op.to));
        break;
      case 'alterField':
        summary.push(`alter field ${op.ctx.apiId}.${op.to.name}`);
        steps.push(alterField(op.ctx, op.from, op.to, warnings));
        break;
    }
  }
  return {
    up: steps.flatMap((s) => s.up),
    down: [...steps].reverse().flatMap((s) => s.down),
    warnings,
    summary,
  };
}

export { isMultiRelation };
