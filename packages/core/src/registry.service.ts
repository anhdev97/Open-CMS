import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ContentGroupDefinition, ContentTypeDefinition } from '@opencloudcms/schema';
import { buildEntryValidator } from '@opencloudcms/schema';
import { OPENCLOUDCMS_OPTIONS, type EntryHooks, type ResolvedOpenCloudCmsOptions } from './options';

/** In-memory registry of content types. Reloaded after the builder applies a migration. */
@Injectable()
export class ContentRegistry {
  private byApiId = new Map<string, ContentTypeDefinition>();
  private contentGroups: ContentGroupDefinition[] = [];
  private validators = new Map<string, ReturnType<typeof buildEntryValidator>>();
  private hooks = new Map<string, EntryHooks[]>();

  constructor(@Inject(OPENCLOUDCMS_OPTIONS) options: ResolvedOpenCloudCmsOptions) {
    this.reload(options.contentTypes);
    this.reloadGroups(options.contentGroups ?? []);
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

  all(): ContentTypeDefinition[] {
    return [...this.byApiId.values()];
  }

  get(apiId: string): ContentTypeDefinition {
    const def = this.byApiId.get(apiId);
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
