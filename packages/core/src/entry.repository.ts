/**
 * Dynamic repository over the generated ct_* tables. Table and column names
 * come from @opencloudcms/schema's physical mapping, the same code that generated
 * the migrations, so runtime and schema can't drift apart.
 */
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { ContentTypeDefinition, FieldDefinition } from '@opencloudcms/schema';
import { fieldColumns, fieldIndex, fieldStorage, isMultiRelation, l10nTable, mainTable, SYSTEM_TABLES } from '@opencloudcms/schema';
import { OPENCLOUDCMS_DB, type PublishedDocument } from './options';

type Row = Record<string, any>;
export type Status = 'draft' | 'published';

export interface ListQuery {
  status: Status;
  locales: string[];
  filters: Record<string, string>;
  sort?: { field: string; direction: 'asc' | 'desc' };
  limit: number;
  offset: number;
  /** Only documents whose workflow row is `in_review` (spec B §5.3). */
  inReview?: boolean;
  /** Server-side only (never from request input): main-table column -> required value. */
  mainWhere?: Record<string, string | boolean>;
}

/** Runs inside a repository write transaction, before the write (workflow locks and checks). */
export type InTransaction = (trx: Kysely<any>) => Promise<void>;

const META_SORT: Record<string, string> = { createdAt: 'created_at', updatedAt: 'updated_at', publishedAt: 'published_at' };

function toColumnValues(field: FieldDefinition, value: unknown): Row {
  const cols = fieldColumns(field);
  if (field.kind === 'money') {
    const v = value as { amount: number; currency: string } | null | undefined;
    return { [cols[0].name]: v?.amount ?? null, [cols[1].name]: v?.currency ?? null };
  }
  if (cols[0].type === 'jsonb') return { [cols[0].name]: value == null ? null : JSON.stringify(value) };
  return { [cols[0].name]: value ?? null };
}

function fromColumnValues(field: FieldDefinition, row: Row | null | undefined): unknown {
  if (!row) return null;
  const cols = fieldColumns(field);
  const v = row[cols[0].name];
  switch (field.kind) {
    case 'money':
      return v == null ? null : { amount: Number(v), currency: String(row[cols[1].name]).trim() };
    case 'number':
      return v == null ? null : Number(v);
    case 'datetime':
      return v instanceof Date ? v.toISOString() : v ?? null;
    default:
      return v ?? null;
  }
}

function parseFilterValue(field: FieldDefinition, raw: string): unknown {
  if (field.kind === 'number' || field.kind === 'money') {
    const n = Number(raw);
    if (Number.isNaN(n)) throw new BadRequestException(`filter[${field.name}] must be a number`);
    return n;
  }
  if (field.kind === 'boolean') return raw === 'true';
  return raw;
}

/**
 * Postgres unique violation (23505) -> 409 `unique_violation`. The field is found from the violated index name,
 * which is the one `fieldIndex` generates for unique fields; unknown indexes (e.g. document/status) omit `issues`.
 */
export function mapUniqueViolation(def: ContentTypeDefinition, e: unknown): unknown {
  const err = e as { code?: string; constraint?: string };
  if (err?.code !== '23505') return e;
  const field = def.fields.find((f) => fieldIndex(def, f)?.name === err.constraint);
  return new ConflictException({
    code: 'unique_violation',
    message: field ? `${field.name} is already used` : 'A unique value is already used',
    ...(field ? { issues: [{ path: [field.name], message: 'already used' }] } : {}),
  });
}

const MAX_DOCUMENT_IDS = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `filter[documentId][in]=a,b`: 1..100 uuids. */
function parseDocumentIds(raw: string): string[] {
  const ids = raw.split(',').map((s) => s.trim());
  if (ids.length > MAX_DOCUMENT_IDS) throw new BadRequestException(`filter[documentId][in] accepts at most ${MAX_DOCUMENT_IDS} ids`);
  if (ids.some((id) => !UUID_RE.test(id))) throw new BadRequestException('filter[documentId][in] must be a comma-separated list of UUIDs');
  return [...new Set(ids)];
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null) ?? null);

@Injectable()
export class EntryRepository {
  constructor(@Inject(OPENCLOUDCMS_DB) private readonly db: Kysely<any>) {}

  private async writeTx(def: ContentTypeDefinition, fn: (trx: Kysely<any>) => Promise<void>): Promise<void> {
    try {
      await this.db.transaction().execute(fn);
    } catch (e) {
      throw mapUniqueViolation(def, e);
    }
  }

  /** Splits API input into main-table columns, l10n columns and relation lists. */
  private split(def: ContentTypeDefinition, data: Row) {
    const main: Row = {};
    const l10n: Row = {};
    const rels: Record<string, string[]> = {};
    for (const field of def.fields) {
      if (!(field.name in data)) continue;
      const storage = fieldStorage(def, field);
      if (storage.mode === 'relation') rels[field.name] = (data[field.name] as string[] | null) ?? [];
      else Object.assign(storage.location === 'main' ? main : l10n, toColumnValues(field, data[field.name]));
    }
    return { main, l10n, rels };
  }

  private async writeRelations(trx: Kysely<any>, def: ContentTypeDefinition, entryId: string, rels: Record<string, string[]>) {
    for (const [name, ids] of Object.entries(rels)) {
      const field = def.fields.find((f) => f.name === name)!;
      const table = fieldStorage(def, field).table;
      await trx.deleteFrom(table).where('entry_id', '=', entryId).execute();
      const unique = [...new Set(ids)];
      if (unique.length) {
        await trx
          .insertInto(table)
          .values(unique.map((target_id, sort_order) => ({ entry_id: entryId, target_id, sort_order })))
          .execute();
      }
    }
  }

  private async findRowId(db: Kysely<any>, def: ContentTypeDefinition, documentId: string, status: Status) {
    const row = await db
      .selectFrom(mainTable(def))
      .select(['id'])
      .where('document_id', '=', documentId)
      .where('status', '=', status)
      .executeTakeFirst();
    return (row?.id as string | undefined) ?? null;
  }

  /** `inTrx` runs first in the write transaction, with the new entry's documentId. */
  async create(def: ContentTypeDefinition, data: Row, locale: string, inTrx?: (trx: Kysely<any>, documentId: string) => Promise<void>): Promise<string> {
    const documentId = randomUUID();
    const id = randomUUID();
    const { main, l10n, rels } = this.split(def, data);
    await this.writeTx(def, async (trx) => {
      await inTrx?.(trx, documentId);
      await trx.insertInto(mainTable(def)).values({ id, document_id: documentId, status: 'draft', ...main }).execute();
      if (Object.keys(l10n).length) {
        await trx.insertInto(l10nTable(def)).values({ entry_id: id, locale, status: 'draft', ...l10n }).execute();
      }
      await this.writeRelations(trx, def, id, rels);
    });
    return documentId;
  }

  /** `expectedUpdatedAt` (ISO): optimistic check against the draft row, 409 `stale_draft` on mismatch. */
  async update(
    def: ContentTypeDefinition,
    documentId: string,
    data: Row,
    locale: string,
    inTrx?: InTransaction,
    expectedUpdatedAt?: string,
  ): Promise<void> {
    const { main, l10n, rels } = this.split(def, data);
    await this.writeTx(def, async (trx) => {
      await inTrx?.(trx);
      const current = await trx
        .selectFrom(mainTable(def))
        .select(['id', 'updated_at'])
        .where('document_id', '=', documentId)
        .where('status', '=', 'draft')
        .forUpdate()
        .executeTakeFirst();
      if (!current) throw new NotFoundException(`${def.apiId} ${documentId} not found`);
      const id = current.id as string;
      if (expectedUpdatedAt !== undefined && new Date(expectedUpdatedAt).getTime() !== new Date(current.updated_at as Date).getTime()) {
        throw new ConflictException({ code: 'stale_draft', message: 'The draft was changed since it was loaded', updatedAt: iso(current.updated_at) });
      }
      await trx.updateTable(mainTable(def)).set({ ...main, updated_at: sql`now()` }).where('id', '=', id).execute();
      if (Object.keys(l10n).length) {
        await trx
          .insertInto(l10nTable(def))
          .values({ entry_id: id, locale, status: 'draft', ...l10n })
          .onConflict((oc) => oc.columns(['entry_id', 'locale']).doUpdateSet(l10n))
          .execute();
      }
      await this.writeRelations(trx, def, id, rels);
    });
  }

  /** Loads l10n rows and relations for a batch of main rows and maps them to API objects. */
  private async hydrate(def: ContentTypeDefinition, rows: Row[], locales: string[]): Promise<Row[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const hasL10n = def.fields.some((f) => f.localizable);
    const l10nByEntry = new Map<string, Row>();
    if (hasL10n && locales.length) {
      const l10nRows = await this.db
        .selectFrom(l10nTable(def))
        .selectAll()
        .where('entry_id', 'in', ids)
        .where('locale', 'in', locales)
        .execute();
      for (const r of l10nRows) {
        const current = l10nByEntry.get(r.entry_id);
        if (!current || locales.indexOf(r.locale) < locales.indexOf(current.locale)) l10nByEntry.set(r.entry_id, r);
      }
    }
    const relsByField = new Map<string, Map<string, string[]>>();
    for (const field of def.fields.filter(isMultiRelation)) {
      const table = fieldStorage(def, field).table;
      const relRows = await this.db
        .selectFrom(table)
        .select(['entry_id', 'target_id'])
        .where('entry_id', 'in', ids)
        .orderBy('sort_order')
        .execute();
      const m = new Map<string, string[]>();
      for (const r of relRows) m.set(r.entry_id, [...(m.get(r.entry_id) ?? []), r.target_id]);
      relsByField.set(field.name, m);
    }

    return rows.map((row) => {
      const l10n = l10nByEntry.get(row.id) ?? null;
      const out: Row = {
        documentId: row.document_id,
        status: row.status,
        locale: l10n?.locale ?? null,
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
        publishedAt: iso(row.published_at),
      };
      if (row.status === 'draft') {
        out.hasUnpublishedChanges = !row.published_at || new Date(row.updated_at) > new Date(row.published_at);
      }
      for (const field of def.fields) {
        if (isMultiRelation(field)) out[field.name] = relsByField.get(field.name)?.get(row.id) ?? [];
        else out[field.name] = fromColumnValues(field, field.localizable ? l10n : row);
      }
      return out;
    });
  }

  async findOne(def: ContentTypeDefinition, documentId: string, status: Status, locales: string[]): Promise<Row | null> {
    const row = await this.db
      .selectFrom(mainTable(def))
      .selectAll()
      .where('document_id', '=', documentId)
      .where('status', '=', status)
      .executeTakeFirst();
    if (!row) return null;
    return (await this.hydrate(def, [row], locales))[0];
  }

  async list(def: ContentTypeDefinition, q: ListQuery): Promise<{ items: Row[]; total: number }> {
    const main = mainTable(def);
    const l10n = l10nTable(def);
    const primaryLocale = q.locales[0];
    let query = this.db.selectFrom(`${main} as m`).where('m.status', '=', q.status);
    if (q.inReview) {
      query = query.where(({ exists, selectFrom }) =>
        exists(
          selectFrom(`${SYSTEM_TABLES.workflow} as w`)
            .select(sql.lit(1).as('one'))
            .where('w.api_id', '=', def.apiId)
            .whereRef('w.document_id', '=', 'm.document_id')
            .where('w.state', '=', 'in_review'),
        ),
      );
    }

    for (const [col, value] of Object.entries(q.mainWhere ?? {})) query = query.where(`m.${col}`, '=', value);

    for (const [name, raw] of Object.entries(q.filters)) {
      if (name === 'documentId[in]') {
        // Only for documentId; allowed regardless of `indexed`.
        query = query.where('m.document_id', 'in', parseDocumentIds(raw));
        continue;
      }
      const field = def.fields.find((f) => f.name === name);
      if (!field) throw new BadRequestException(`Unknown filter field "${name}"`);
      if (!field.indexed && !field.unique) {
        throw new BadRequestException(`Field "${name}" is not indexed. Mark it indexed in the schema to filter on it.`);
      }
      const storage = fieldStorage(def, field);
      if (storage.mode !== 'columns') throw new BadRequestException(`Cannot filter on relation list "${name}"`);
      const col = storage.columns[0].name;
      const value = parseFilterValue(field, raw);
      if (storage.location === 'main') {
        query = query.where(`m.${col}`, '=', value);
      } else {
        query = query.where(({ exists, selectFrom }) =>
          exists(
            selectFrom(`${l10n} as lf`)
              .select(sql.lit(1).as('one'))
              .whereRef('lf.entry_id', '=', 'm.id')
              .where('lf.locale', '=', primaryLocale)
              .where(`lf.${col}`, '=', value),
          ),
        );
      }
    }

    const countRow = await query.select((eb) => eb.fn.countAll<string>().as('count')).executeTakeFirst();
    const total = Number(countRow?.count ?? 0);

    let rowsQuery = query.selectAll('m');
    if (q.sort) {
      const meta = META_SORT[q.sort.field];
      if (meta) {
        rowsQuery = rowsQuery.orderBy(`m.${meta}`, q.sort.direction);
      } else {
        const field = def.fields.find((f) => f.name === q.sort!.field);
        if (!field || (!field.indexed && !field.unique)) {
          throw new BadRequestException(`Can only sort by createdAt, updatedAt, publishedAt or indexed fields`);
        }
        const storage = fieldStorage(def, field);
        if (storage.mode !== 'columns') throw new BadRequestException(`Cannot sort by relation list`);
        const col = storage.columns[0].name;
        if (storage.location === 'main') rowsQuery = rowsQuery.orderBy(`m.${col}`, q.sort.direction);
        else {
          rowsQuery = rowsQuery
            .leftJoin(`${l10n} as ls`, (join) => join.onRef('ls.entry_id', '=', 'm.id').on('ls.locale', '=', primaryLocale))
            .orderBy(`ls.${col}`, q.sort.direction);
        }
      }
    } else {
      rowsQuery = rowsQuery.orderBy('m.created_at', 'desc');
    }
    rowsQuery = rowsQuery.orderBy('m.id');
    const rows = await rowsQuery.limit(q.limit).offset(q.offset).execute();
    return { items: await this.hydrate(def, rows, q.locales), total };
  }

  /** Every locale of a draft (or published) document, for validation and version snapshots. */
  async exportDocument(def: ContentTypeDefinition, documentId: string, status: Status): Promise<PublishedDocument | null> {
    const row = await this.db
      .selectFrom(mainTable(def))
      .selectAll()
      .where('document_id', '=', documentId)
      .where('status', '=', status)
      .executeTakeFirst();
    if (!row) return null;
    const [hydrated] = await this.hydrate(def, [row], []);
    const shared: Row = {};
    for (const field of def.fields) if (!field.localizable) shared[field.name] = hydrated[field.name];
    const translations: Record<string, Row> = {};
    const l10nRows = await this.db.selectFrom(l10nTable(def)).selectAll().where('entry_id', '=', row.id).execute();
    for (const r of l10nRows) {
      const t: Row = {};
      for (const field of def.fields) if (field.localizable) t[field.name] = fromColumnValues(field, r);
      translations[r.locale] = t;
    }
    return { documentId, shared, translations };
  }

  /**
   * Copies the draft row (plus translations and relations) into a fresh
   * published row, in one transaction. Storefront reads only published rows.
   */
  async publish(def: ContentTypeDefinition, documentId: string, snapshot: PublishedDocument, inTrx?: InTransaction): Promise<void> {
    const main = mainTable(def);
    const l10n = l10nTable(def);
    const mainCols: string[] = [];
    const l10nCols: string[] = [];
    for (const field of def.fields) {
      const s = fieldStorage(def, field);
      if (s.mode === 'columns') (s.location === 'main' ? mainCols : l10nCols).push(...s.columns.map((c) => c.name));
    }
    await this.writeTx(def, async (trx) => {
      await inTrx?.(trx);
      const draftId = await this.findRowId(trx, def, documentId, 'draft');
      if (!draftId) throw new NotFoundException(`${def.apiId} ${documentId} not found`);
      await trx.deleteFrom(main).where('document_id', '=', documentId).where('status', '=', 'published').execute();
      const pubId = randomUUID();
      const refs = (cols: string[]) => sql.join(cols.map((c) => sql.ref(c)));
      const mainList = ['id', 'document_id', 'status', 'created_at', 'updated_at', 'published_at', ...mainCols];
      await sql`insert into ${sql.table(main)} (${refs(mainList)})
        select ${pubId}, document_id, 'published', created_at, now(), now()${mainCols.length ? sql`, ${refs(mainCols)}` : sql``}
        from ${sql.table(main)} where id = ${draftId}`.execute(trx);
      const l10nList = ['entry_id', 'locale', 'status', ...l10nCols];
      await sql`insert into ${sql.table(l10n)} (${refs(l10nList)})
        select ${pubId}, locale, 'published'${l10nCols.length ? sql`, ${refs(l10nCols)}` : sql``}
        from ${sql.table(l10n)} where entry_id = ${draftId}`.execute(trx);
      for (const field of def.fields.filter(isMultiRelation)) {
        const rel = fieldStorage(def, field).table;
        await sql`insert into ${sql.table(rel)} (entry_id, target_id, sort_order)
          select ${pubId}, target_id, sort_order from ${sql.table(rel)} where entry_id = ${draftId}`.execute(trx);
      }
      // Draft remembers when it was last published (drives hasUnpublishedChanges: updated_at > published_at).
      // Its updated_at is left alone: it is the editor's If-Match version, and publishing does not change the draft.
      await trx.updateTable(main).set({ published_at: sql`now()` }).where('id', '=', draftId).execute();
      await trx
        .insertInto(SYSTEM_TABLES.entryVersions)
        .values({ content_type: def.apiId, document_id: documentId, snapshot: JSON.stringify(snapshot) })
        .execute();
    });
  }

  async unpublish(def: ContentTypeDefinition, documentId: string, db: Kysely<any> = this.db): Promise<boolean> {
    const r = await db
      .deleteFrom(mainTable(def))
      .where('document_id', '=', documentId)
      .where('status', '=', 'published')
      .executeTakeFirst();
    return Number(r.numDeletedRows) > 0;
  }

  async delete(def: ContentTypeDefinition, documentId: string, inTrx?: InTransaction): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      await inTrx?.(trx);
      const r = await trx.deleteFrom(mainTable(def)).where('document_id', '=', documentId).executeTakeFirst();
      return Number(r.numDeletedRows) > 0;
    });
  }

  async versions(def: ContentTypeDefinition, documentId: string) {
    return this.db
      .selectFrom(SYSTEM_TABLES.entryVersions)
      .select(['id', 'created_at as createdAt', 'snapshot'])
      .where('content_type', '=', def.apiId)
      .where('document_id', '=', documentId)
      .orderBy('created_at', 'desc')
      .execute();
  }
}
