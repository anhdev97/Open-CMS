import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ContentGroupDefinition, ContentTypeDefinition } from '@opencms/schema';
import { buildEntryValidator } from '@opencms/schema';
import { OPENCMS_OPTIONS, type EntryHooks, type ResolvedOpenCmsOptions } from './options';

/** In-memory registry of content types. Reloaded after the builder applies a migration. */
@Injectable()
export class ContentRegistry {
  private byApiId = new Map<string, ContentTypeDefinition>();
  private contentGroups: ContentGroupDefinition[] = [];
  private validators = new Map<string, ReturnType<typeof buildEntryValidator>>();
  private hooks = new Map<string, EntryHooks[]>();

  constructor(@Inject(OPENCMS_OPTIONS) options: ResolvedOpenCmsOptions) {
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
