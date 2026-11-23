import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ContentGroupDefinition, ContentTypeDefinition } from '@opencloudcms/schema';
import { buildEntryValidator, PAGE_API_ID } from '@opencloudcms/schema';
import { pageHooks } from './pages/page.hooks';
import { pageType } from './pages/page.type';
import { OPENCLOUDCMS_OPTIONS, type EntryHooks, type ResolvedOpenCloudCmsOptions } from './options';

/** In-memory registry of content types. Reloaded after the builder applies a migration. */
@Injectable()
export class ContentRegistry {
  private byApiId = new Map<string, ContentTypeDefinition>();
  /** Core-owned types: survive `reload`, never written to project schema files or snapshots. */
  private coreById = new Map<string, { def: ContentTypeDefinition; hidden: boolean; editable: boolean }>();
  private contentGroups: ContentGroupDefinition[] = [];
  private validators = new Map<string, ReturnType<typeof buildEntryValidator>>();
  private hooks = new Map<string, EntryHooks[]>();

  constructor(@Inject(OPENCLOUDCMS_OPTIONS) options: ResolvedOpenCloudCmsOptions) {
    this.registerCore(pageType, { hidden: true, editable: false });
    this.reload(options.contentTypes);
    this.reloadGroups(options.contentGroups ?? []);
    this.hooks.set(PAGE_API_ID, [pageHooks]);
    for (const h of options.hooks) this.hooks.set(h.apiId, [...(this.hooks.get(h.apiId) ?? []), h.hooks]);
  }

  reload(defs: ContentTypeDefinition[]): void {
    this.byApiId = new Map(defs.map((d) => [d.apiId, d]));
    this.validators.clear();
  }

  reloadGroups(groups: ContentGroupDefinition[]): void {
    this.contentGroups = [...groups];
  }

  groups(): ContentGroupDefinition[] {
    return [...this.contentGroups];
  }

  registerCore(def: ContentTypeDefinition, opts: { hidden: boolean; editable: boolean }): void {
    this.coreById.set(def.apiId, { def, ...opts });
    this.validators.clear();
  }

  isCore(apiId: string): boolean {
    return this.coreById.has(apiId);
  }

  /** Every type, core ones included (internal use: locale usage, review queue, group checks). */
  all(): ContentTypeDefinition[] {
    return [...[...this.coreById.values()].map((c) => c.def), ...this.byApiId.values()];
  }

  /** Types shown to the Builder and the admin meta; hidden core types only with `includeHidden`. */
  list(opts: { includeHidden?: boolean } = {}): ContentTypeDefinition[] {
    const core = [...this.coreById.values()].filter((c) => opts.includeHidden || !c.hidden).map((c) => c.def);
    return [...core, ...this.byApiId.values()];
  }

  get(apiId: string): ContentTypeDefinition {
    const def = this.coreById.get(apiId)?.def ?? this.byApiId.get(apiId);
    if (!def) throw new NotFoundException(`Unknown content type "${apiId}"`);
    return def;
  }

  validator(def: ContentTypeDefinition, mode: 'draft' | 'publish') {
    const key = `${def.apiId}:${mode}`;
    let v = this.validators.get(key);
    if (!v) {
      v = buildEntryValidator(def, mode);
      this.validators.set(key, v);
    }
    return v;
  }

  hooksFor(apiId: string): EntryHooks[] {
    return this.hooks.get(apiId) ?? [];
  }
}
