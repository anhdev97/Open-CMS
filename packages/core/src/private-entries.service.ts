/**
 * Server API for private content types (spec §7, decision 13): project modules inject this to create and change
 * entries that the public never sees, including `readOnly` fields that the admin API refuses to write.
 */
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { ContentTypeDefinition } from '@opencloudcms/schema';
import type { RequestUser } from '@opencloudcms/oauth2';
import { EntriesService, type ListParams } from './entries.service';
import { OPENCLOUDCMS_OPTIONS, type ResolvedOpenCloudCmsOptions } from './options';
import { ContentRegistry } from './registry.service';

type Row = Record<string, unknown>;

export interface PrivateEntryCallOptions {
  /**
   * The user on whose behalf the call runs. Absent: the actor is `system`. Entries store no author today, so it
   * only reaches the update guards (which never lock a private entry: private types have no review).
   */
  user?: Pick<RequestUser, 'id' | 'permissions'>;
}

/** List parameters of the server API: drafts are the only rows a private entry has, so no status or workflow. */
export type PrivateListParams = Omit<ListParams, 'status' | 'workflow' | 'mainWhere' | 'locale' | 'fallback'>;

/**
 * Same field validation and registered entry hooks as the admin API, may write `readOnly` fields, never publishes.
 * Each call runs in its own transaction (the repository's write transaction). Private types have no localizable
 * fields, so every call works in the default locale. Calls for a type that is not private throw 400 `not_private`.
 */
@Injectable()
export class PrivateEntriesService {
  constructor(
    @Inject(EntriesService) private readonly entries: EntriesService,
    @Inject(ContentRegistry) private readonly registry: ContentRegistry,
    @Inject(OPENCLOUDCMS_OPTIONS) private readonly options: ResolvedOpenCloudCmsOptions,
  ) {}

  private def(apiId: string): ContentTypeDefinition {
    const def = this.registry.get(apiId);
    if (!def.private) {
      throw new BadRequestException({ code: 'not_private', message: `"${apiId}" is not a private content type: use EntriesService for public types` });
    }
    return def;
  }

  private get locale(): string {
    return this.options.config.defaultLocale;
  }

  /**
   * Maps asset field values before validation. Today asset fields take existing asset ids only, so values pass
   * through; this is where uploaded files (`{ buffer, filename, contentType }`) become private asset ids.
   */
  private async mapAssetValues(def: ContentTypeDefinition, data: unknown): Promise<unknown> {
    void def;
    return data;
  }

  /** `opts.user` is accepted for symmetry; entries store no author yet, so a create records no actor. */
  async create(apiId: string, data: Row, _opts: PrivateEntryCallOptions = {}) {
    const def = this.def(apiId);
    return this.entries.create(apiId, await this.mapAssetValues(def, data), this.locale, { writeReadOnly: true });
  }

  async update(apiId: string, documentId: string, data: Row, opts: PrivateEntryCallOptions = {}) {
    const def = this.def(apiId);
    return this.entries.update(apiId, documentId, await this.mapAssetValues(def, data), this.locale, opts.user, { writeReadOnly: true });
  }

  async get(apiId: string, documentId: string) {
    this.def(apiId);
    return this.entries.get(apiId, documentId, 'draft', this.locale);
  }

  async list(apiId: string, params: PrivateListParams = {}) {
    this.def(apiId);
    return this.entries.list(apiId, { ...params, status: 'draft', locale: this.locale });
  }

  async remove(apiId: string, documentId: string) {
    this.def(apiId);
    return this.entries.remove(apiId, documentId);
  }
}
