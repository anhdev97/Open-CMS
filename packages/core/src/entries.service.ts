import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { ContentTypeDefinition, Locale } from '@opencloudcms/schema';
import { AuthError, type RequestUser } from '@opencloudcms/oauth2';
import { EntryRepository, type ListQuery, type Status } from './entry.repository';
import { OPENCLOUDCMS_DB, OPENCLOUDCMS_OPTIONS, type HookContext, type ResolvedOpenCloudCmsOptions } from './options';
import { ContentRegistry } from './registry.service';
import { WorkflowService } from './workflow.service';

type Row = Record<string, unknown>;

export interface ListParams {
  status?: Status;
  locale?: string;
  fallback?: string;
  filter?: Record<string, string>;
  sort?: string;
  limit?: string | number;
  offset?: string | number;
  /** Admin only: `in_review` lists entries waiting for review (spec B §5.3). */
  workflow?: string;
}

@Injectable()
export class EntriesService {
  constructor(
    @Inject(ContentRegistry) private readonly registry: ContentRegistry,
    @Inject(EntryRepository) private readonly repo: EntryRepository,
    @Inject(OPENCLOUDCMS_OPTIONS) private readonly options: ResolvedOpenCloudCmsOptions,
    @Inject(OPENCLOUDCMS_DB) private readonly db: Kysely<any>,
    @Inject(WorkflowService) private readonly workflow: WorkflowService,
  ) {}

  private ctx(apiId: string, locale: string): HookContext {
    return { apiId, locale, db: this.db };
  }

  private locale(locale?: string): string {
    const l = locale || this.options.config.defaultLocale;
    if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(l)) throw new BadRequestException(`Invalid locale "${l}"`);
    if (!this.options.config.locales.includes(l as Locale)) {
      throw new BadRequestException({ code: 'locale_not_enabled', message: `Locale "${l}" is not enabled` });
    }
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
    const status = params.status ?? 'published';
    if (params.workflow !== undefined && params.workflow !== 'in_review') throw new BadRequestException('workflow must be in_review');
    const inReview = params.workflow === 'in_review';
    // A type without review has nothing in review (rows left from before review was turned off are ignored).
    if (inReview && (status !== 'draft' || !def.review)) return { data: [], meta: { total: 0, limit, offset } };
    const { items, total } = await this.repo.list(def, {
      status,
      locales: this.localeChain(params.locale, params.fallback),
      filters,
      sort,
      limit,
      offset,
      inReview,
    });
    await this.workflow.attach(def, items);
    return { data: items, meta: { total, limit, offset } };
  }

  async get(apiId: string, documentId: string, status: Status, locale?: string, fallback?: string) {
    const def = this.registry.get(apiId);
    const entry = await this.repo.findOne(def, documentId, status, this.localeChain(locale, fallback));
    if (!entry) throw new NotFoundException(`${apiId} ${documentId} not found`);
    await this.workflow.attach(def, [entry]);
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

  /** `user` absent = trusted server-side call: the In review lock (B7) does not apply. */
  async update(apiId: string, documentId: string, body: unknown, locale?: string, user?: Pick<RequestUser, 'permissions'>) {
    const def = this.registry.get(apiId);
    const loc = this.locale(locale);
    let data = this.validate(def, body, 'draft');
    for (const h of this.registry.hooksFor(apiId)) {
      const r = await h.beforeUpdate?.(data, { ...this.ctx(apiId, loc), documentId });
      if (r && typeof r === 'object') data = r as Row;
    }
    await this.repo.update(def, documentId, data, loc, (trx) => this.workflow.guardUpdate(trx, def, documentId, user));
    return this.get(apiId, documentId, 'draft', loc);
  }

  /**
   * Spec B §4.2: a type with `review: true` is published only with `content.publish`; without review,
   * `content.update` or `content.publish` suffices. Lives here (not in a decorator) because it depends on the type.
   */
  private assertCanPublish(def: ContentTypeDefinition, user: Pick<RequestUser, 'permissions'>): void {
    const has = (p: string) => user.permissions.includes(p as never);
    if (def.review) {
      if (!has('content.publish')) throw new AuthError('forbidden', 403, 'Missing permission: content.publish');
    } else if (!has('content.update') && !has('content.publish')) {
      throw new AuthError('forbidden', 403, 'Missing permission: content.update');
    }
  }

  /**
   * `publish`: direct publish (a `content.publish` holder may skip review, ruling R11). `approve`: publish what
   * was submitted; only from In review (409 `invalid_transition`). Both run the same pipeline and clear the row.
   */
  async publish(apiId: string, documentId: string, user: Pick<RequestUser, 'id' | 'permissions'>, action: 'publish' | 'approve' = 'publish') {
    const def = this.registry.get(apiId);
    this.assertCanPublish(def, user);
    const doc = await this.repo.exportDocument(def, documentId, 'draft');
    if (!doc) throw new NotFoundException(`${apiId} ${documentId} not found`);
    await this.workflow.precheckPublish(def, documentId, action);

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
    await this.repo.publish(def, documentId, doc, (trx) => this.workflow.guardPublish(trx, def, documentId, user, action));
    for (const h of this.registry.hooksFor(apiId)) await h.afterPublish?.(doc, ctx);
    return this.get(apiId, documentId, 'published');
  }

  async unpublish(apiId: string, documentId: string, user: Pick<RequestUser, 'permissions'>) {
    const def = this.registry.get(apiId);
    this.assertCanPublish(def, user);
    const removed = await this.repo.unpublish(def, documentId);
    if (!removed) throw new NotFoundException(`${apiId} ${documentId} is not published`);
    for (const h of this.registry.hooksFor(apiId)) await h.afterUnpublish?.(documentId, this.ctx(apiId, this.options.config.defaultLocale));
    return { ok: true };
  }

  async remove(apiId: string, documentId: string) {
    const def = this.registry.get(apiId);
    if (!(await this.repo.delete(def, documentId, (trx) => this.workflow.guardDelete(trx, def, documentId)))) throw new NotFoundException(`${apiId} ${documentId} not found`);
    for (const h of this.registry.hooksFor(apiId)) await h.afterDelete?.(documentId, this.ctx(apiId, this.options.config.defaultLocale));
    return { ok: true };
  }

  /** submit / withdraw / reject (spec B §4.2); returns the draft with its new `workflow`. */
  async transition(apiId: string, documentId: string, action: 'submit' | 'withdraw' | 'reject', user: Pick<RequestUser, 'id' | 'permissions'>, note?: unknown) {
    const def = this.registry.get(apiId);
    await this.workflow.transition(def, documentId, action, user, note);
    return this.get(apiId, documentId, 'draft');
  }

  async versions(apiId: string, documentId: string) {
    return { data: await this.repo.versions(this.registry.get(apiId), documentId) };
  }
}
