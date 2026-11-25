import { ConflictException } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { l10nTable, mainTable } from '@opencloudcms/schema';
import { pageType } from './page.type';

// Physical names (codegen naming of page.type.ts; see migrations 0006_pages / 0007_page_kind).
export const PAGE_MAIN = mainTable(pageType);
export const PAGE_L10N = l10nTable(pageType);

export interface BaseUsagePage {
  documentId: string;
  title: string | null;
  path: string | null;
}

export interface BaseUsage {
  count: number;
  pages: BaseUsagePage[];
}

/**
 * Serializes changes of the default base with unpublishing / deleting a base (transaction-scoped advisory lock):
 * without it, concurrent calls could leave two defaults or an unpublished default.
 */
export async function lockDefaultBase(trx: Kysely<any>): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtext('opencloudcms.page.default'))`.execute(trx);
}

/** `{ isDefault }` of the base document (any row), or null when no base document has this id. */
export async function findBase(db: Kysely<any>, documentId: string, status?: 'draft' | 'published'): Promise<{ isDefault: boolean } | null> {
  const r = await sql<{ is_default: boolean }>`
    select bool_or(is_default) as is_default from ${sql.table(PAGE_MAIN)}
    where document_id = ${documentId} and kind = 'base'${status ? sql` and status = ${status}` : sql``}
    having count(*) > 0`.execute(db);
  return r.rows[0] ? { isDefault: !!r.rows[0].is_default } : null;
}

/**
 * Page documents of kind `page` (draft or published, counted once) that a base frames: `layout.baseId` is the base
 * or, for the default base, `layout` is null. Title and path from the draft in `defaultLocale` when there is one.
 */
export async function baseUsage(db: Kysely<any>, baseId: string, isDefault: boolean, defaultLocale: string): Promise<BaseUsage> {
  const r = await sql<{ document_id: string; title: string | null; path: string | null }>`
    select distinct on (m.document_id) m.document_id, l.title, l.path
    from ${sql.table(PAGE_MAIN)} m left join ${sql.table(PAGE_L10N)} l on l.entry_id = m.id
    where m.kind = 'page' and (m.layout->>'baseId' = ${baseId}${isDefault ? sql` or m.layout is null` : sql``})
    order by m.document_id, (m.status = 'draft') desc, (l.locale = ${defaultLocale}) desc nulls last, l.locale`.execute(db);
  const pages = r.rows
    .map((x) => ({ documentId: x.document_id, title: x.title, path: x.path }))
    .sort((a, b) => (a.title ?? '').localeCompare(b.title ?? '') || a.documentId.localeCompare(b.documentId));
  return { count: pages.length, pages };
}

/**
 * Refuses unpublishing or deleting the default base (409 `base_is_default`) and a base that pages use
 * (409 `base_in_use`, the pages in `issues`); `force` lets an unpublish through the latter only. `db` must be the
 * unpublish / delete transaction: for a base page the default-base lock is taken and the checks run under it.
 */
export async function guardBaseRemoval(
  db: Kysely<any>,
  documentId: string,
  op: 'unpublish' | 'delete',
  opts: { force?: boolean; defaultLocale: string },
): Promise<void> {
  // `kind` never changes, so a document that is not a base needs no lock.
  if (!(await findBase(db, documentId))) return;
  await lockDefaultBase(db);
  // Unpublish: only a published base matters (otherwise the request 404s as usual).
  const base = await findBase(db, documentId, op === 'unpublish' ? 'published' : undefined);
  if (!base) return;
  if (base.isDefault) {
    throw new ConflictException({
      code: 'base_is_default',
      message: `The default base page cannot be ${op === 'delete' ? 'deleted' : 'unpublished'}. Make another base page the default or clear the default first.`,
    });
  }
  if (op === 'unpublish' && opts.force) return;
  const usage = await baseUsage(db, documentId, false, opts.defaultLocale);
  if (!usage.count) return;
  throw new ConflictException({
    code: 'base_in_use',
    message: `The base page is used by ${usage.count} page${usage.count === 1 ? '' : 's'}`,
    issues: usage.pages.map((p) => ({ path: [p.documentId], message: p.title ?? p.path ?? p.documentId })),
  });
}
