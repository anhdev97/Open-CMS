import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException, type OnModuleInit } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import {
  collectBlockNames,
  fieldStorage,
  l10nTable,
  mainTable,
  matchDetailPath,
  PAGE_API_ID,
  parseSlugPattern,
  slugPattern,
  type BlockManifest,
  type ContentTypeDefinition,
  type DetailPageOptions,
  type DetailParam,
  type StoredPageContent,
} from '@opencloudcms/schema';
import { EntriesService } from '../entries.service';
import { OPENCLOUDCMS_DB, OPENCLOUDCMS_OPTIONS, type ResolvedOpenCloudCmsOptions } from '../options';
import { PageBlocksManifest } from '../block-builder/page-blocks-manifest';
import { ContentRegistry } from '../registry.service';
import { baseUsage, findBase, lockDefaultBase, PAGE_MAIN, type BaseUsage } from './bases';
import { detailPaths, detailState } from './detail';
import { unknownBlocks } from './page.hooks';
import { shadowedPagePaths } from './shadowed';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A trailing `{id}` part of a slug value: `-<uuid>` or the whole value. */
const TRAILING_UUID_RE = /(?:^|-)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
/** A trailing `{id6}` part: 6 hex, or 8 after a prefix collision (slugs.ts); always at least 6. */
const TRAILING_ID6_RE = /(?:^|-)([0-9a-f]{6,8})$/;

export interface DetailStatus {
  detailPage: DetailPageOptions | null;
  detailTemplate: boolean;
  templateId: string | null;
  misconfigured: boolean;
  duplicateSlugs: number;
}

export interface BlocksCheckItem {
  documentId: string;
  locale: string;
  title: string | null;
  unknown: string[];
}

@Injectable()
export class PagesService implements OnModuleInit {
  private readonly logger = new Logger('OpenCloudCms');
  private shadowedPaths: string[] = [];

  constructor(
    @Inject(EntriesService) private readonly entries: EntriesService,
    @Inject(ContentRegistry) private readonly registry: ContentRegistry,
    @Inject(OPENCLOUDCMS_OPTIONS) private readonly options: ResolvedOpenCloudCmsOptions,
    @Inject(OPENCLOUDCMS_DB) private readonly db: Kysely<any>,
    @Inject(PageBlocksManifest) private readonly blocks: PageBlocksManifest,
  ) {}

  onModuleInit(): void {
    const web = this.options.web;
    // Computed once at boot: file routes only change with a code change (and a restart).
    this.shadowedPaths = web?.enabled === false ? [] : shadowedPagePaths(web?.dir ?? process.cwd());
    if (!this.blocks.current()) {
      this.logger.warn('pages.blocks is not set: publishing pages does not check for unknown blocks. Pass the project block manifest as `pages: { blocks }` to OpenCloudCmsModule.forRoot.');
    }
  }

  /**
   * The page of `locale` (exact, no fallback) whose path is `path`: `{ data }`. Otherwise (spec §3 routing), when the
   * path matches a content type's detail pattern, that type's template in `locale` plus the entry:
   * `{ data: template, routeEntry, detail: { apiId } }`. `status` applies to both (published for the public API,
   * drafts for the admin API, which needs a session). 404 when nothing matches.
   */
  async byPath(status: 'draft' | 'published', path: string | undefined, locale: string | undefined) {
    if (!path) throw new BadRequestException('Query parameter "path" is required');
    const loc = locale || this.options.config.defaultLocale;
    // Base pages and detail templates are never served at a path: filtered in the query, so they can never take the one result.
    const { data } = await this.entries.list(PAGE_API_ID, { status, locale: loc, filter: { path }, mainWhere: { kind: 'page' }, limit: 1 });
    // The list falls back to the default locale for display; by-path must match the requested locale only.
    const hit = data.find((d) => d.locale === loc);
    if (hit) return { data: hit };
    const detail = await this.detailByPath(status, path, loc);
    if (!detail) throw new NotFoundException(`No page at ${path}`);
    return detail;
  }

  /** Project types (core types never have detail pages). */
  private projectTypes(): ContentTypeDefinition[] {
    return this.registry.all().filter((d) => !this.registry.isCore(d.apiId));
  }

  /** Exact page paths came first (decision 3); private and misconfigured types never match (`matchDetailPath`). */
  private async detailByPath(status: 'draft' | 'published', path: string, loc: string) {
    // A detail path has at least one static segment before `{slug}` / `{id}`: `/` and `/x` never match.
    if (!/^\/[^/]+\/[^/]+/.test(path)) return null;
    const m = matchDetailPath(this.projectTypes(), path);
    if (!m) return null;
    const def = this.registry.get(m.apiId);
    if (def.private || !detailState(def).usable) return null;
    const template = await this.template(def.apiId, status, loc);
    if (!template) return null;
    const documentId = await this.routeEntryId(def, m.param, m.value, status, loc);
    if (!documentId) return null;
    let routeEntry: Record<string, unknown>;
    try {
      ({ data: routeEntry } = await this.entries.get(def.apiId, documentId, status, loc));
    } catch (e) {
      // Deleted between the lookup and the read.
      if (e instanceof NotFoundException) return null;
      throw e;
    }
    return { data: template, routeEntry, detail: { apiId: def.apiId } };
  }

  /** The detail template of `apiId` in `locale` (exact, like pages), `status` row. */
  private async template(apiId: string, status: 'draft' | 'published', loc: string): Promise<Record<string, unknown> | null> {
    const { data } = await this.entries.list(PAGE_API_ID, { status, locale: loc, mainWhere: { kind: 'detail', detail_api_id: apiId }, limit: 1 });
    return data.find((d) => d.locale === loc) ?? null;
  }

  /**
   * Document id of the `status` entry that a detail URL value names. `{id}` paths: the documentId. `{slug}` paths: an
   * exact slug match (a localized slug in `loc` only; with old duplicate values the oldest entry); when there is none
   * and the slug pattern ends with `{id}` / `{id6}`, the trailing id part: the full documentId, or a documentId
   * prefix of 6–8 hex that exactly one entry has (a slug whose other parts changed still resolves).
   */
  private async routeEntryId(def: ContentTypeDefinition, param: DetailParam, value: string, status: 'draft' | 'published', loc: string): Promise<string | null> {
    const main = sql.table(mainTable(def));
    if (param === 'id') {
      const r = await sql<{ document_id: string }>`select document_id from ${main} where document_id = ${value} and status = ${status}`.execute(this.db);
      return r.rows[0]?.document_id ?? null;
    }
    const field = def.fields.find((x) => x.name === def.detailPage?.slugField);
    if (!field) return null;
    const storage = fieldStorage(def, field);
    if (storage.mode !== 'columns') return null;
    const col = sql.ref(storage.columns[0].name);
    const l10n = storage.location !== 'main';
    const exact = l10n
      ? await sql<{ document_id: string }>`
          select m.document_id from ${main} m join ${sql.table(l10nTable(def))} l on l.entry_id = m.id
          where m.status = ${status} and l.locale = ${loc} and l.${col} = ${value}
          order by m.created_at, m.id limit 1`.execute(this.db)
      : await sql<{ document_id: string }>`
          select document_id from ${main} where status = ${status} and ${col} = ${value}
          order by created_at, id limit 1`.execute(this.db);
    if (exact.rows[0]) return exact.rows[0].document_id;

    const pattern = slugPattern(field);
    const last = pattern ? parseSlugPattern(pattern, def).parts.at(-1) : undefined;
    if (last?.kind !== 'id' && last?.kind !== 'id6') return null;
    const id = last.kind === 'id' ? TRAILING_UUID_RE.exec(value)?.[1] : TRAILING_ID6_RE.exec(value)?.[1];
    if (!id) return null;
    // A localized slug: the entry must exist in the requested locale, as for an exact match.
    const inLocale = l10n
      ? sql` and exists (select 1 from ${sql.table(l10nTable(def))} l where l.entry_id = m.id and l.locale = ${loc})`
      : sql``;
    const match = last.kind === 'id' ? sql`m.document_id = ${id}` : sql`m.document_id::text like ${`${id}%`}`;
    const r = await sql<{ document_id: string }>`
      select m.document_id from ${main} m where m.status = ${status} and ${match}${inLocale} limit 2`.execute(this.db);
    return r.rows.length === 1 ? r.rows[0].document_id : null;
  }

  /** `{ data: { [apiId]: { path, slugField? } } }`: usable detail pages of non-private types (public). */
  detailPaths(): { data: Record<string, DetailPageOptions> } {
    return { data: detailPaths(this.projectTypes()) };
  }

  /** Admin status of a type's detail page (spec §3, decision 12). 404 for an unknown type. */
  async detailStatus(apiId: string): Promise<{ data: DetailStatus }> {
    const def = this.registry.get(apiId);
    const state = detailState(def);
    const t = await sql<{ document_id: string }>`
      select document_id from ${sql.table(PAGE_MAIN)} where kind = 'detail' and detail_api_id = ${def.apiId}
      order by (status = 'draft') desc, created_at limit 1`.execute(this.db);
    const templateId = t.rows[0]?.document_id ?? null;
    return {
      data: {
        detailPage: state.config,
        detailTemplate: templateId !== null,
        templateId,
        misconfigured: state.misconfigured,
        duplicateSlugs: state.usable?.param === 'slug' ? await this.duplicateSlugs(def) : 0,
      },
    };
  }

  /** Slug values (per locale for a localized slug) that more than one published entry holds: detail URLs serve one of them. */
  private async duplicateSlugs(def: ContentTypeDefinition): Promise<number> {
    const field = def.fields.find((x) => x.name === def.detailPage?.slugField);
    if (!field) return 0;
    const storage = fieldStorage(def, field);
    if (storage.mode !== 'columns') return 0;
    const col = sql.ref(storage.columns[0].name);
    const main = sql.table(mainTable(def));
    const r =
      storage.location !== 'main'
        ? await sql<{ n: string }>`select count(*) as n from (
            select 1 from ${main} m join ${sql.table(l10nTable(def))} l on l.entry_id = m.id
            where m.status = 'published' and l.${col} is not null and l.${col} <> ''
            group by l.locale, l.${col} having count(distinct m.document_id) > 1) d`.execute(this.db)
        : await sql<{ n: string }>`select count(*) as n from (
            select 1 from ${main} where status = 'published' and ${col} is not null and ${col} <> ''
            group by ${col} having count(distinct document_id) > 1) d`.execute(this.db);
    return Number(r.rows[0]?.n ?? 0);
  }

  /** Document ids of base pages that have a `status` row, the default first, then by creation. */
  private async baseIds(status: 'draft' | 'published'): Promise<string[]> {
    const r = await sql<{ document_id: string }>`
      select document_id from ${sql.table(PAGE_MAIN)} where kind = 'base' and status = ${status}
      order by is_default desc, created_at, document_id`.execute(this.db);
    return r.rows.map((x) => x.document_id);
  }

  /** Base pages (`status` rows, default locale), the default first. */
  async bases(status: 'draft' | 'published') {
    const ids = await this.baseIds(status);
    if (!ids.length) return { data: [] };
    const out: Record<string, unknown>[] = [];
    // `documentId[in]` accepts at most 100 ids per request.
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const { data } = await this.entries.list(PAGE_API_ID, { status, filter: { 'documentId[in]': chunk.join(',') }, limit: 100 });
      const byId = new Map(data.map((d) => [d.documentId as string, d]));
      for (const id of chunk) if (byId.has(id)) out.push(byId.get(id)!);
    }
    return { data: out };
  }

  /**
   * Document id of the default base page having a `status` row, or null. Should two rows ever be marked (written
   * outside the API), the most recently updated wins, deterministically.
   */
  async defaultBase(status: 'draft' | 'published'): Promise<string | null> {
    const r = await sql<{ document_id: string }>`
      select document_id from ${sql.table(PAGE_MAIN)} where kind = 'base' and is_default and status = ${status}
      order by updated_at desc, id limit 1`.execute(this.db);
    return r.rows[0]?.document_id ?? null;
  }

  /**
   * Makes a published base page the default (null clears it). At most one base document is default: the others
   * are cleared in the same transaction. Both rows (draft and published) of the document carry the flag.
   */
  async setDefault(documentId: string | null): Promise<{ data: { documentId: string | null } }> {
    if (documentId !== null && (typeof documentId !== 'string' || !UUID_RE.test(documentId))) {
      throw new BadRequestException('documentId must be a document id or null');
    }
    const notPublished = () => new ConflictException({ code: 'base_not_published', message: 'Only a published base page can be the default' });
    await this.db.transaction().execute(async (trx) => {
      // Same lock as the unpublish / delete guards: checks and writes cannot interleave with them or each other.
      await lockDefaultBase(trx);
      if (documentId !== null) {
        if (!(await findBase(trx, documentId))) throw new UnprocessableEntityException({ code: 'unknown_base', message: `No base page ${documentId}` });
        if (!(await findBase(trx, documentId, 'published'))) throw notPublished();
      }
      await sql`update ${sql.table(PAGE_MAIN)} set is_default = false where is_default`.execute(trx);
      if (documentId !== null) {
        const r = await sql`update ${sql.table(PAGE_MAIN)} m set is_default = true
          where m.document_id = ${documentId} and m.kind = 'base'
            and exists (select 1 from ${sql.table(PAGE_MAIN)} p where p.document_id = m.document_id and p.status = 'published')`.execute(trx);
        // Defensive (the lock makes it unreachable): no published row, nothing marked; roll back to the previous default.
        if (!Number(r.numAffectedRows ?? 0)) throw notPublished();
      }
    });
    return { data: { documentId } };
  }

  /** Pages that `documentId` frames (explicitly, or as the default for pages without a layout). 404 for a non-base. */
  async usage(documentId: string): Promise<BaseUsage> {
    const base = await findBase(this.db, documentId);
    if (!base) throw new NotFoundException(`No base page ${documentId}`);
    return baseUsage(this.db, documentId, base.isDefault, this.options.config.defaultLocale);
  }

  /**
   * The base page `id` (a document id or `default`) in `locale`, falling back to the default locale. Published or
   * draft per `status`. 404 when absent, not a base page, or there is no default.
   */
  async base(status: 'draft' | 'published', id: string | undefined, locale: string | undefined) {
    if (!id) throw new BadRequestException('Query parameter "id" is required');
    if (id !== 'default' && !UUID_RE.test(id)) throw new BadRequestException('id must be a document id or "default"');
    const documentId = id === 'default' ? await this.defaultBase(status) : id;
    if (!documentId) throw new NotFoundException('There is no default base page');
    const notFound = () => new NotFoundException(`No base page ${id}`);
    let entry: Record<string, unknown>;
    try {
      ({ data: entry } = await this.entries.get(PAGE_API_ID, documentId, status, locale));
    } catch (e) {
      if (e instanceof NotFoundException) throw notFound();
      throw e;
    }
    if (entry.kind !== 'base') throw notFound();
    return { data: entry };
  }

  /** Static paths of the website's own file routes (`app/(site)/**\/page.*`): Next serves them before any page built here. */
  shadowed(): { data: string[] } {
    return { data: [...this.shadowedPaths] };
  }

  /** Every page row (draft and published, every locale) with its title and stored content. */
  private async pageRows() {
    const def = this.registry.get(PAGE_API_ID);
    const col = (name: string) => {
      const field = def.fields.find((f) => f.name === name)!;
      const s = fieldStorage(def, field);
      if (s.mode !== 'columns') throw new Error(`${name} is not a column field`);
      return s.columns[0].name;
    };
    const rows = await sql<{ document_id: string; status: string; locale: string; title: string | null; content: unknown }>`
      select m.document_id, m.status, l.locale, l.${sql.ref(col('title'))} as title, l.${sql.ref(col('content'))} as content
      from ${sql.table(mainTable(def))} m join ${sql.table(l10nTable(def))} l on l.entry_id = m.id
      order by m.document_id, l.locale, m.status`.execute(this.db);
    return rows.rows;
  }

  /** Block name -> number of distinct page documents (draft or published, any locale) whose content uses it. */
  async blockUsage(): Promise<Map<string, number>> {
    const docs = new Map<string, Set<string>>();
    for (const r of await this.pageRows()) {
      for (const name of collectBlockNames(r.content as StoredPageContent | null).keys()) {
        let set = docs.get(name);
        if (!set) docs.set(name, (set = new Set()));
        set.add(r.document_id);
      }
    }
    return new Map([...docs].map(([name, set]) => [name, set.size]));
  }

  /** Pages (drafts and published, per locale) that use blocks missing from the manifest. */
  async blocksCheck(): Promise<{ data: BlocksCheckItem[]; manifest: BlockManifest | null }> {
    const manifest = this.blocks.current() ?? null;
    if (!manifest) return { data: [], manifest: null };
    const rows = await this.pageRows();
    // Draft first (its title is what the editor shows), published merged in.
    const out = new Map<string, BlocksCheckItem>();
    for (const r of rows.sort((a, b) => (a.status === b.status ? 0 : a.status === 'draft' ? -1 : 1))) {
      const unknown = [...unknownBlocks(r.content, manifest).keys()];
      const key = `${r.document_id}|${r.locale}`;
      const cur = out.get(key);
      if (cur) cur.unknown = [...new Set([...cur.unknown, ...unknown])];
      else out.set(key, { documentId: r.document_id, locale: r.locale, title: r.title, unknown });
    }
    const data = [...out.values()].filter((i) => i.unknown.length).map((i) => ({ ...i, unknown: i.unknown.sort() }));
    data.sort((a, b) => (a.documentId + a.locale).localeCompare(b.documentId + b.locale));
    return { data, manifest };
  }
}
