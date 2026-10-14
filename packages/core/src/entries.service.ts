import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { ContentTypeDefinition } from '@opencms/schema';
import { EntryRepository, type ListQuery, type Status } from './entry.repository';
import { OPENCMS_DB, OPENCMS_OPTIONS, type HookContext, type ResolvedOpenCmsOptions } from './options';
import { ContentRegistry } from './registry.service';

type Row = Record<string, unknown>;

export interface ListParams {
  status?: Status;
  locale?: string;
  fallback?: string;
  filter?: Record<string, string>;
  sort?: string;
  limit?: string | number;
  offset?: string | number;
}

@Injectable()
export class EntriesService {
  constructor(
    @Inject(ContentRegistry) private readonly registry: ContentRegistry,
    @Inject(EntryRepository) private readonly repo: EntryRepository,
    @Inject(OPENCMS_OPTIONS) private readonly options: ResolvedOpenCmsOptions,
    @Inject(OPENCMS_DB) private readonly db: Kysely<any>,
  ) {}

  private ctx(apiId: string, locale: string): HookContext {
    return { apiId, locale, db: this.db };
  }

  private locale(locale?: string): string {
    const l = locale || this.options.config.defaultLocale;
    if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(l)) throw new BadRequestException(`Invalid locale "${l}"`);
    return l;
  }

  /** Requested locale, then explicit fallbacks, then the default locale. */
  private localeChain(locale?: string, fallback?: string): string[] {
    const chain = [this.locale(locale), ...(fallback ? fallback.split(',').map((x) => this.locale(x.trim())) : [])];
    chain.push(this.options.config.defaultLocale);
    return [...new Set(chain)];
  }

  private validate(def: ContentTypeDefinition, data: unknown, mode: 'draft' | 'publish'): Row {
    const result = this.registry.validator(def, mode).safeParse(data ?? {});
    if (!result.success) {
      throw new BadRequestException({
        message: `Invalid ${def.apiId} data`,
        issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return result.data as Row;
  }

  async list(apiId: string, params: ListParams) {
    const def = this.registry.get(apiId);
    const limit = Math.min(Math.max(Number(params.limit ?? 25) || 25, 1), 100);
    const offset = Math.max(Number(params.offset ?? 0) || 0, 0);
    let sort: ListQuery['sort'];
    if (params.sort) {
      const [field, dir = 'asc'] = params.sort.split(':');
      if (dir !== 'asc' && dir !== 'desc') throw new BadRequestException('sort direction must be asc or desc');
      sort = { field, direction: dir };
    }
    const filters = typeof params.filter === 'object' && params.filter ? params.filter : {};
    const { items, total } = await this.repo.list(def, {
      status: params.status ?? 'published',
      locales: this.localeChain(params.locale, params.fallback),
      filters,
      sort,
      limit,
      offset,
    });
    return { data: items, meta: { total, limit, offset } };
  }

  async get(apiId: string, documentId: string, status: Status, locale?: string, fallback?: string) {
    const def = this.registry.get(apiId);
    const entry = await this.repo.findOne(def, documentId, status, this.localeChain(locale, fallback));
    if (!entry) throw new NotFoundException(`${apiId} ${documentId} not found`);
    return { data: entry };
  }

  async create(apiId: string, body: unknown, locale?: string) {
    const def = this.registry.get(apiId);
    const loc = this.locale(locale);
    let data = this.validate(def, body, 'draft');
    for (const h of this.registry.hooksFor(apiId)) {
      const r = await h.beforeCreate?.(data, this.ctx(apiId, loc));
      if (r && typeof r === 'object') data = r as Row;
    }
    const documentId = await this.repo.create(def, data, loc);
    return this.get(apiId, documentId, 'draft', loc);
  }

  async update(apiId: string, documentId: string, body: unknown, locale?: string) {
    const def = this.registry.get(apiId);
    const loc = this.locale(locale);
    let data = this.validate(def, body, 'draft');
    for (const h of this.registry.hooksFor(apiId)) {
      const r = await h.beforeUpdate?.(data, { ...this.ctx(apiId, loc), documentId });
      if (r && typeof r === 'object') data = r as Row;
    }
    await this.repo.update(def, documentId, data, loc);
    return this.get(apiId, documentId, 'draft', loc);
  }

  async publish(apiId: string, documentId: string) {
    const def = this.registry.get(apiId);
    const doc = await this.repo.exportDocument(def, documentId, 'draft');
    if (!doc) throw new NotFoundException(`${apiId} ${documentId} not found`);

    // Required fields: shared ones once, localizable ones in every translation that exists.
    const locales = Object.keys(doc.translations);
    const combos = locales.length ? locales.map((l) => ({ ...doc.shared, ...doc.translations[l] })) : [doc.shared];
    const issues: { locale: string | null; path: string; message: string }[] = [];
    combos.forEach((data, i) => {
      const r = this.registry.validator(def, 'publish').safeParse(data);
      if (!r.success) {
        for (const issue of r.error.issues) issues.push({ locale: locales[i] ?? null, path: issue.path.join('.'), message: issue.message });
      }
    });
    if (issues.length) throw new BadRequestException({ message: `Cannot publish ${apiId}: validation failed`, issues });

    const ctx = this.ctx(apiId, this.options.config.defaultLocale);
    for (const h of this.registry.hooksFor(apiId)) await h.beforePublish?.(doc, ctx);
    await this.repo.publish(def, documentId, doc);
    for (const h of this.registry.hooksFor(apiId)) await h.afterPublish?.(doc, ctx);
    return this.get(apiId, documentId, 'published');
  }

  async unpublish(apiId: string, documentId: string) {
    const def = this.registry.get(apiId);
    const removed = await this.repo.unpublish(def, documentId);
    if (!removed) throw new NotFoundException(`${apiId} ${documentId} is not published`);
    for (const h of this.registry.hooksFor(apiId)) await h.afterUnpublish?.(documentId, this.ctx(apiId, this.options.config.defaultLocale));
    return { ok: true };
  }

  async remove(apiId: string, documentId: string) {
    const def = this.registry.get(apiId);
    if (!(await this.repo.delete(def, documentId))) throw new NotFoundException(`${apiId} ${documentId} not found`);
    for (const h of this.registry.hooksFor(apiId)) await h.afterDelete?.(documentId, this.ctx(apiId, this.options.config.defaultLocale));
    return { ok: true };
  }

  async versions(apiId: string, documentId: string) {
    return { data: await this.repo.versions(this.registry.get(apiId), documentId) };
  }
}
