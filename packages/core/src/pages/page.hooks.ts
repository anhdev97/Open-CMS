import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import {
  collectBlockNames,
  PAGE_KINDS,
  validatePageLayout,
  validatePagePath,
  type BlockManifest,
  type ContentTypeDefinition,
  type PageKind,
  type StoredPageContent,
} from '@opencloudcms/schema';
import type { HookRegistration, PublishedDocument } from '../options';
import { guardBaseRemoval, lockForBasePublish, PAGE_MAIN } from './bases';
import { normalizeStoredRichText } from './richtext';

const unprocessable = (code: string, message: string) => new UnprocessableEntityException({ code, message });
const isEmpty = (v: unknown) => v == null || v === '';

function checkPath(data: Record<string, unknown>): void {
  // A draft may omit the path (publish requires it); when present it must be valid.
  if (!('path' in data) || data.path == null || data.path === '') return;
  const r = validatePagePath(String(data.path));
  if (!r.ok) throw new UnprocessableEntityException({ code: r.code, message: r.message });
}

/** Block name -> occurrences for blocks of `content` that are not in `manifest`. */
export function unknownBlocks(content: unknown, manifest: BlockManifest): Map<string, number> {
  const known = new Set(manifest.map((b) => b.name));
  const out = new Map<string, number>();
  for (const [name, n] of collectBlockNames(content as StoredPageContent | null)) if (!known.has(name)) out.set(name, n);
  return out;
}

/** `b.richText` values of the saved `content` normalized (no scripts, event handlers or `javascript:` links). */
function normalizeContent(data: Record<string, unknown>, manifest: BlockManifest | undefined): Record<string, unknown> {
  if (!manifest || !('content' in data)) return data;
  return { ...data, content: normalizeStoredRichText(data.content, manifest) };
}

interface StoredDraft {
  kind: PageKind;
  isDefault: boolean;
  detailApiId: string | null;
}

/** Stored `kind` / `isDefault` / `detailApiId` of the draft row, or null when there is none (the update then 404s). */
async function storedDraft(db: Kysely<any>, documentId: string): Promise<StoredDraft | null> {
  const r = await sql<{ kind: PageKind; is_default: boolean; detail_api_id: string | null }>`
    select kind, is_default, detail_api_id from ${sql.table(PAGE_MAIN)} where document_id = ${documentId} and status = 'draft'`.execute(db);
  const row = r.rows[0];
  return row ? { kind: row.kind, isDefault: row.is_default, detailApiId: row.detail_api_id } : null;
}

const detailHasPath = () => unprocessable('detail_has_path', 'A detail template has no path: it is served at the content type\'s detail path');

/**
 * Create checks of `detailApiId`: only on templates; there it must name a non-private type with a detail page and no
 * template yet (draft or published). The `(status, detail_api_id)` unique index backs the last check against races.
 */
async function checkDetailCreate(
  data: Record<string, unknown>,
  kind: PageKind,
  defs: () => readonly ContentTypeDefinition[],
  db: Kysely<any>,
): Promise<Record<string, unknown>> {
  const apiId = data.detailApiId;
  if (kind !== 'detail') {
    if (!isEmpty(apiId)) throw unprocessable('detail_not_allowed', 'Only a detail template (kind detail) has a detailApiId');
    if (!('detailApiId' in data)) return data;
    const { detailApiId: _drop, ...rest } = data;
    return rest;
  }
  if (!isEmpty(data.path)) throw detailHasPath();
  const def = typeof apiId === 'string' ? defs().find((d) => d.apiId === apiId) : undefined;
  if (!def || def.private || !def.detailPage) {
    throw unprocessable('detail_not_enabled', `${isEmpty(apiId) ? 'detailApiId is required' : `Content type "${String(apiId)}" has no detail page`}: turn on its detail page first`);
  }
  const r = await sql`select 1 from ${sql.table(PAGE_MAIN)} where kind = 'detail' and detail_api_id = ${def.apiId} limit 1`.execute(db);
  if (r.rows.length) {
    throw new ConflictException({ code: 'detail_template_exists', message: `Content type "${def.apiId}" already has a detail template` });
  }
  return data;
}

/** `isDefault` is written only by the set-default endpoint; the unchanged value (an echoed document) is dropped. */
function stripManaged(data: Record<string, unknown>, current: boolean): Record<string, unknown> {
  if (!('isDefault' in data)) return data;
  if (data.isDefault != null && data.isDefault !== current) {
    throw unprocessable('managed_field', 'isDefault is set with PUT /api/admin/pages/bases/default');
  }
  const { isDefault: _drop, ...rest } = data;
  return rest;
}

/**
 * Shape of `layout`, none on base pages, and `baseId` (when it is a document id) naming an existing base document
 * (draft or published). An absent `baseId` is the default base page, `null` no base page: neither is looked up.
 */
async function checkLayout(data: Record<string, unknown>, kind: PageKind, db: Kysely<any> | null): Promise<void> {
  if (!('layout' in data)) return;
  const layout = data.layout as { baseId?: string | null } | null | undefined;
  const shape = validatePageLayout(layout);
  if (!shape.ok) throw unprocessable('invalid_layout', shape.message);
  if (layout == null) return;
  if (kind === 'base') throw unprocessable('invalid_layout', 'A base page has no layout of its own');
  if (typeof layout.baseId !== 'string' || !db) return;
  const r = await sql`select 1 from ${sql.table(PAGE_MAIN)} where document_id = ${layout.baseId} and kind = 'base' limit 1`.execute(db);
  if (!r.rows.length) throw unprocessable('unknown_base', `No base page ${layout.baseId}`);
}

/** Names of the manifest's layout blocks. */
const layoutNames = (manifest: BlockManifest) => new Set(manifest.filter((b) => b.kind === 'layout').map((b) => b.name));

/**
 * Kind-specific publish checks. Pages: a path in every translation, no layout block anywhere. Detail templates: no
 * path, no layout block (a base frames them like pages). Base pages: no path,
 * no layout, and content whose root is exactly one layout block (no layout block elsewhere). Block kinds come from
 * the manifest: without one only the path rules apply.
 */
function checkKind(doc: PublishedDocument, manifest: BlockManifest | undefined): void {
  const kind = (doc.shared.kind as PageKind | null) ?? 'page';
  const translations = Object.entries(doc.translations);
  if (kind === 'page') {
    const missing = translations.length ? translations.filter(([, t]) => isEmpty(t.path)).map(([l]) => l) : ['(none)'];
    if (missing.length) throw unprocessable('path_required', `A page needs a path in every locale (missing: ${missing.join(', ')})`);
  } else if (kind === 'detail') {
    if (translations.some(([, t]) => !isEmpty(t.path))) throw detailHasPath();
  } else {
    const withPath = translations.filter(([, t]) => !isEmpty(t.path)).map(([l]) => l);
    if (withPath.length) throw unprocessable('base_has_path', `A base page has no path (set in: ${withPath.join(', ')})`);
    if (doc.shared.layout != null) throw unprocessable('invalid_layout', 'A base page has no layout of its own');
  }
  if (!manifest) return;
  const layouts = layoutNames(manifest);
  for (const [locale, t] of translations) {
    const content = t.content as StoredPageContent | null | undefined;
    let count = 0;
    for (const [name, n] of collectBlockNames(content)) if (layouts.has(name)) count += n;
    if (kind === 'base') {
      const root = Array.isArray(content?.data?.content) ? content!.data.content : [];
      const first = root[0] as { type?: unknown } | undefined;
      if (root.length !== 1 || typeof first?.type !== 'string' || !layouts.has(first.type)) {
        throw unprocessable('invalid_base_root', `A base page's content must be exactly one layout block (${locale})`);
      }
      if (count > 1) throw unprocessable('layout_block_misplaced', `A layout block can only be the root of a base page (${locale})`);
    } else if (count > 0) {
      throw unprocessable('layout_block_misplaced', `A layout block can only be the root of a base page (${locale})`);
    }
  }
}

/**
 * Registered by ContentRegistry for the core page type. Without a manifest, publishing never checks blocks and
 * rich text is not normalized on save (the website renderer still sanitizes it). `manifest` may be a getter
 * (PageBlocksManifest.current), read on every call so that Block Builder changes apply at once.
 */
export function createPageHooks(
  manifest: BlockManifest | undefined | (() => BlockManifest | undefined),
  defs: () => readonly ContentTypeDefinition[] = () => [],
): HookRegistration['hooks'] {
  const get = typeof manifest === 'function' ? manifest : () => manifest;
  return {
    beforeCreate: async (input, ctx) => {
      checkPath(input);
      let data = stripManaged(input, false);
      const kind = (data.kind ?? 'page') as PageKind;
      if (!PAGE_KINDS.includes(kind)) throw unprocessable('invalid_kind', 'kind must be page, base or detail');
      // Absent: the column default ('page'); an explicit null would violate `not null`.
      if ('kind' in data && data.kind == null) data = { ...data, kind };
      data = await checkDetailCreate(data, kind, defs, ctx.db);
      await checkLayout(data, kind, ctx.db);
      return normalizeContent(data, get());
    },
    beforeUpdate: async (input, ctx) => {
      checkPath(input);
      const touchesDetail = 'detailApiId' in input || !isEmpty(input.path);
      if (!('kind' in input) && !('isDefault' in input) && !('layout' in input) && !touchesDetail) return normalizeContent(input, get());
      const current = await storedDraft(ctx.db, ctx.documentId);
      if (!current) return normalizeContent(input, get());
      if (current.kind === 'detail' && !isEmpty(input.path)) throw detailHasPath();
      let data = stripManaged(input, current.isDefault);
      if ('detailApiId' in data) {
        if (data.detailApiId != null && data.detailApiId !== current.detailApiId) {
          throw unprocessable('detail_immutable', 'The content type of a detail template cannot change');
        }
        const { detailApiId: _drop, ...rest } = data;
        data = rest;
      }
      if ('kind' in data) {
        if (data.kind != null && data.kind !== current.kind) throw unprocessable('kind_immutable', 'The kind of a page cannot change');
        const { kind: _drop, ...rest } = data;
        data = rest;
      }
      await checkLayout(data, current.kind, ctx.db);
      return normalizeContent(data, get());
    },
    beforePublish: (doc, ctx) => {
      const manifest = get();
      checkKind(doc, manifest);
      if (!manifest || ctx.force) return;
      const total = new Map<string, number>();
      for (const t of Object.values(doc.translations)) {
        for (const [name, n] of unknownBlocks(t.content, manifest)) total.set(name, (total.get(name) ?? 0) + n);
      }
      if (!total.size) return;
      throw new UnprocessableEntityException({
        code: 'unknown_block',
        message: `Page uses blocks that are not defined: ${[...total.keys()].join(', ')}`,
        issues: [...total].map(([name, n]) => ({ path: [name], message: String(n) })),
      });
    },
    inPublishTransaction: (documentId, ctx) => lockForBasePublish(ctx.db, documentId),
    beforeUnpublish: (documentId, ctx) => guardBaseRemoval(ctx.db, documentId, 'unpublish', { force: ctx.force, defaultLocale: ctx.locale }),
    beforeDelete: (documentId, ctx) => guardBaseRemoval(ctx.db, documentId, 'delete', { defaultLocale: ctx.locale }),
  };
}
