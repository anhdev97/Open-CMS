/**
 * Server API for private content types (spec §7, decision 13): project modules inject this to create and change
 * entries that the public never sees, including `readOnly` fields that the admin API refuses to write.
 */
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { AssetsService, type PrivateFileInput } from '@opencloudcms/assets';
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

/** A file value for an asset field: stored as a private file of the entry (type sniffed against the field `accept`). */
export type PrivateEntryFile = PrivateFileInput;

const isFile = (v: unknown): v is PrivateFileInput =>
  !!v && typeof v === 'object' && Buffer.isBuffer((v as PrivateFileInput).buffer) && typeof (v as PrivateFileInput).filename === 'string';

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
    @Inject(AssetsService) private readonly assets: AssetsService,
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
   * Stores file values (`{ buffer, filename, contentType }`, alone or in a multiple field's array) as private files
   * and puts their ids in their place. The save attaches them; `uploaded` collects them for cleanup on failure.
   */
  private async mapAssetValues(def: ContentTypeDefinition, data: Row, uploaded: string[]): Promise<Row> {
    if (!data || typeof data !== 'object') return data;
    const out: Row = { ...data };
    for (const field of def.fields) {
      if (field.kind !== 'asset' || !(field.name in data)) continue;
      const accept = (field.options as { accept?: string[] }).accept;
      const store = async (v: unknown): Promise<unknown> => {
        if (!isFile(v)) return v;
        const asset = await this.assets.uploadPrivate(v, { ownerApiId: def.apiId, accept });
        uploaded.push(asset.id);
        return asset.id;
      };
      const value = data[field.name];
      if (Array.isArray(value)) {
        const ids: unknown[] = [];
        for (const v of value) ids.push(await store(v));
        out[field.name] = ids;
      } else {
        out[field.name] = await store(value);
      }
    }
    return out;
  }

  /** Runs a write with file values mapped; on failure the files it uploaded are deleted again. */
  private async withFiles<T>(def: ContentTypeDefinition, data: Row, write: (mapped: Row) => Promise<T>): Promise<T> {
    const uploaded: string[] = [];
    try {
      return await write(await this.mapAssetValues(def, data, uploaded));
    } catch (e) {
      for (const id of uploaded) await this.assets.deletePrivate(id).catch(() => {});
      throw e;
    }
  }

  /** `opts.user` is accepted for symmetry; entries store no author yet, so a create records no actor. */
  async create(apiId: string, data: Row, _opts: PrivateEntryCallOptions = {}) {
    const def = this.def(apiId);
    return this.withFiles(def, data, (mapped) => this.entries.create(apiId, mapped, this.locale, { writeReadOnly: true }));
  }

  async update(apiId: string, documentId: string, data: Row, opts: PrivateEntryCallOptions = {}) {
    const def = this.def(apiId);
    return this.withFiles(def, data, (mapped) =>
      this.entries.update(apiId, documentId, mapped, this.locale, opts.user, { writeReadOnly: true }),
    );
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
