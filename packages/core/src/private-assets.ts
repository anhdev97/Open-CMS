/**
 * Private file ownership for entries (spec §7, decision 9). A private asset belongs to exactly one entry of one
 * private type: the save that references it attaches it (`owner_document_id`), replacing it deletes the old file,
 * deleting the entry deletes its files. Asset fields of public types never take private assets.
 */
import { Inject, Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { AssetsService } from '@opencloudcms/assets';
import { fieldStorage, fieldColumns, SYSTEM_TABLES, type ContentTypeDefinition } from '@opencloudcms/schema';
import { OPENCLOUDCMS_DB } from './options';

type Row = Record<string, unknown>;

const idsOf = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === 'string' && x !== '');

const issueError = (code: string, message: string, paths: string[]) =>
  new UnprocessableEntityException({ code, message, issues: paths.map((path) => ({ path, message: code })) });

@Injectable()
export class PrivateAssetOwnership {
  private readonly logger = new Logger('OpenCloudCms');

  constructor(
    @Inject(OPENCLOUDCMS_DB) private readonly db: Kysely<any>,
    @Inject(AssetsService) private readonly assets: AssetsService,
  ) {}

  /** Asset ids per asset field present in `data`. */
  static idsByField(def: ContentTypeDefinition, data: Row): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const f of def.fields) {
      if (f.kind !== 'asset' || !(f.name in data)) continue;
      const ids = idsOf(data[f.name]);
      if (ids.length) out.set(f.name, ids);
    }
    return out;
  }

  /** Public types: any private asset id → 422 `asset_private` with the field paths. */
  async assertNoPrivate(def: ContentTypeDefinition, data: Row): Promise<void> {
    if (def.private) return;
    const byField = PrivateAssetOwnership.idsByField(def, data);
    const all = [...new Set([...byField.values()].flat())];
    if (!all.length) return;
    const rows = await this.db.selectFrom(SYSTEM_TABLES.assets).select('id').where('id', 'in', all).where('visibility', '=', 'private').execute();
    if (!rows.length) return;
    const priv = new Set(rows.map((r) => r.id as string));
    const paths = [...byField].filter(([, ids]) => ids.some((id) => priv.has(id))).map(([name]) => name);
    throw issueError('asset_private', `Private files cannot be used in ${def.apiId}: ${paths.join(', ')}`, paths);
  }

  /**
   * Private types, inside the write transaction: every referenced asset must be a private file of this type that is
   * unattached or already this entry's (else 422 `asset_not_owned`); unattached ones are attached to `documentId`.
   */
  async attach(trx: Kysely<any>, def: ContentTypeDefinition, documentId: string, data: Row): Promise<void> {
    if (!def.private) return;
    const byField = PrivateAssetOwnership.idsByField(def, data);
    const all = [...new Set([...byField.values()].flat())];
    if (!all.length) return;
    const rows = await trx
      .selectFrom(SYSTEM_TABLES.assets)
      .select(['id', 'visibility', 'owner_api_id', 'owner_document_id'])
      .where('id', 'in', all)
      .forUpdate()
      .execute();
    const byId = new Map(rows.map((r) => [r.id as string, r]));
    const ok = (id: string) => {
      const r = byId.get(id);
      return !!r && r.visibility === 'private' && r.owner_api_id === def.apiId && (r.owner_document_id == null || r.owner_document_id === documentId);
    };
    const paths = [...byField].filter(([, ids]) => !ids.every(ok)).map(([name]) => name);
    if (paths.length) {
      throw issueError('asset_not_owned', `Files of ${paths.join(', ')} must be private uploads for this ${def.apiId} entry`, paths);
    }
    await trx
      .updateTable(SYSTEM_TABLES.assets)
      .set({ owner_document_id: documentId })
      .where('id', 'in', all)
      .where('owner_document_id', 'is', null)
      .execute();
  }

  /**
   * In the update transaction, after the write (the draft row is locked, so concurrent saves of this entry run one
   * after the other): this entry's private files that its stored asset fields no longer reference are detached
   * (`owner_document_id = null`) and returned. Delete exactly those after commit with `deleteDetached`.
   */
  async detachReplaced(trx: Kysely<any>, def: ContentTypeDefinition, documentId: string, rowId: string): Promise<string[]> {
    if (!def.private) return [];
    const owned = await trx
      .selectFrom(SYSTEM_TABLES.assets)
      .select('id')
      .where('visibility', '=', 'private')
      .where('owner_api_id', '=', def.apiId)
      .where('owner_document_id', '=', documentId)
      .forUpdate()
      .execute();
    if (!owned.length) return [];
    const referenced = new Set<string>();
    for (const f of def.fields) {
      if (f.kind !== 'asset') continue;
      const storage = fieldStorage(def, f);
      if (storage.mode === 'relation') {
        const rows = await trx.selectFrom(storage.table).select('target_id').where('entry_id', '=', rowId).execute();
        for (const r of rows) referenced.add(r.target_id as string);
      } else {
        const col = fieldColumns(f)[0]!.name;
        const rows = storage.location === 'main'
          ? await trx.selectFrom(storage.table).select(col).where('id', '=', rowId).execute()
          : await trx.selectFrom(storage.table).select(col).where('entry_id', '=', rowId).execute();
        for (const r of rows) if (r[col]) referenced.add(r[col] as string);
      }
    }
    const replaced = owned.map((r) => r.id as string).filter((id) => !referenced.has(id));
    if (replaced.length) {
      await trx.updateTable(SYSTEM_TABLES.assets).set({ owner_document_id: null }).where('id', 'in', replaced).execute();
    }
    return replaced;
  }

  /**
   * After the update committed: deletes the files `detachReplaced` detached. Each delete is conditional (still
   * unattached), so a file that a save attached again meanwhile is kept.
   */
  async deleteDetached(ids: string[]): Promise<void> {
    await this.remove(ids, null);
  }

  /** After an entry delete: deletes all of its private files (nothing can attach to a deleted entry). */
  async deleteOwned(def: ContentTypeDefinition, documentId: string): Promise<void> {
    if (!def.private) return;
    await this.remove(await this.owned(def, documentId), documentId);
  }

  private async owned(def: ContentTypeDefinition, documentId: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom(SYSTEM_TABLES.assets)
      .select('id')
      .where('visibility', '=', 'private')
      .where('owner_api_id', '=', def.apiId)
      .where('owner_document_id', '=', documentId)
      .execute();
    return rows.map((r) => r.id as string);
  }

  /**
   * The entry write has already committed: deletes are conditional on the owner the caller expects, and failures
   * are logged, not reported (a detached file left behind is swept as an unattached upload).
   */
  private async remove(ids: string[], ownerDocumentId: string | null): Promise<void> {
    for (const id of ids) {
      try {
        await this.assets.deletePrivate(id, { ownerDocumentId });
      } catch (e) {
        this.logger.error(`Could not delete private asset ${id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
}
