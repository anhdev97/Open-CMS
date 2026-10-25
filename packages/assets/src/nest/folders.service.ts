import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Kysely } from 'kysely';
import { SYSTEM_TABLES } from '@opencms/schema';
import { ASSETS_DB } from '../constants';
import { slugifyFilename } from '../seo/slug';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface FolderApiRow {
  id: string;
  parentId: string | null;
  slug: string;
  name: string;
  createdAt: Date | string;
}

function toApi(row: any): FolderApiRow {
  return {
    id: row.id,
    parentId: row.parent_id ?? null,
    slug: row.slug,
    name: row.name,
    createdAt: row.created_at,
  };
}

@Injectable()
export class FoldersService {
  constructor(@Inject(ASSETS_DB) private readonly db: Kysely<any>) {}

  async list(): Promise<{ data: FolderApiRow[] }> {
    const rows = await this.db.selectFrom(SYSTEM_TABLES.assetFolders).selectAll().orderBy('name', 'asc').execute();
    return { data: rows.map(toApi) };
  }

  async create(body: { name?: string; parentId?: string | null }): Promise<{ data: FolderApiRow }> {
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 255) throw new BadRequestException('name is required (1–255 characters)');
    const parentId = await this.resolveParent(body.parentId);
    const slug = await this.uniqueSlug(name, parentId);
    try {
      const row = await this.db
        .insertInto(SYSTEM_TABLES.assetFolders)
        .values({ name, slug, parent_id: parentId })
        .returningAll()
        .executeTakeFirstOrThrow();
      return { data: toApi(row) };
    } catch (e: any) {
      if (e?.code === '23505') throw new ConflictException('A folder with this name already exists here');
      throw e;
    }
  }

  async patch(id: string, body: { name?: string; parentId?: string | null }): Promise<{ data: FolderApiRow }> {
    if (!UUID_RE.test(id)) throw new NotFoundException('Folder not found');
    const existing = await this.db.selectFrom(SYSTEM_TABLES.assetFolders).selectAll().where('id', '=', id).executeTakeFirst();
    if (!existing) throw new NotFoundException('Folder not found');

    const patch: Record<string, unknown> = {};
    if (body && 'name' in body) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name || name.length > 255) throw new BadRequestException('name is required (1–255 characters)');
      patch.name = name;
      const parentForSlug = body && 'parentId' in body ? await this.resolveParent(body.parentId) : existing.parent_id;
      patch.slug = await this.uniqueSlug(name, parentForSlug, id);
    }
    if (body && 'parentId' in body) {
      const parentId = await this.resolveParent(body.parentId);
      if (parentId === id) throw new BadRequestException('A folder cannot be its own parent');
      if (parentId && (await this.isDescendant(parentId, id))) {
        throw new BadRequestException('Cannot move a folder into one of its descendants');
      }
      patch.parent_id = parentId;
      if (!('name' in body)) {
        patch.slug = await this.uniqueSlug(existing.name, parentId, id);
      }
    }
    if (Object.keys(patch).length === 0) throw new BadRequestException('Nothing to update');

    try {
      const row = await this.db
        .updateTable(SYSTEM_TABLES.assetFolders)
        .set(patch)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      return { data: toApi(row) };
    } catch (e: any) {
      if (e?.code === '23505') throw new ConflictException('A folder with this name already exists here');
      throw e;
    }
  }

  /** Deletes only when the folder has no children and no assets. */
  async delete(id: string): Promise<{ data: { id: string } }> {
    if (!UUID_RE.test(id)) throw new NotFoundException('Folder not found');
    const existing = await this.db.selectFrom(SYSTEM_TABLES.assetFolders).select('id').where('id', '=', id).executeTakeFirst();
    if (!existing) throw new NotFoundException('Folder not found');

    const child = await this.db
      .selectFrom(SYSTEM_TABLES.assetFolders)
      .select('id')
      .where('parent_id', '=', id)
      .executeTakeFirst();
    if (child) throw new ConflictException('Folder is not empty (has subfolders)');

    const asset = await this.db.selectFrom(SYSTEM_TABLES.assets).select('id').where('folder_id', '=', id).executeTakeFirst();
    if (asset) throw new ConflictException('Folder is not empty (has assets)');

    await this.db.deleteFrom(SYSTEM_TABLES.assetFolders).where('id', '=', id).execute();
    return { data: { id } };
  }

  /** Slug path from root → folder, e.g. `products/phones`. */
  async pathSlugs(folderId: string | null): Promise<string> {
    if (!folderId) return '';
    const parts: string[] = [];
    let id: string | null = folderId;
    const guard = new Set<string>();
    while (id) {
      if (guard.has(id)) break;
      guard.add(id);
      const row: { slug: string; parent_id: string | null } | undefined = await this.db
        .selectFrom(SYSTEM_TABLES.assetFolders)
        .select(['slug', 'parent_id'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!row) break;
      parts.unshift(row.slug);
      id = row.parent_id;
    }
    return parts.join('/');
  }

  async assertExists(folderId: string | null | undefined): Promise<string | null> {
    if (folderId == null || folderId === '') return null;
    return this.resolveParent(folderId);
  }

  private async resolveParent(parentId: string | null | undefined): Promise<string | null> {
    if (parentId == null || parentId === '') return null;
    if (!UUID_RE.test(parentId)) throw new BadRequestException('Invalid parentId');
    const row = await this.db.selectFrom(SYSTEM_TABLES.assetFolders).select('id').where('id', '=', parentId).executeTakeFirst();
    if (!row) throw new BadRequestException('Unknown parent folder');
    return row.id;
  }

  /** True if `nodeId` is under `ancestorId` in the tree. */
  private async isDescendant(nodeId: string, ancestorId: string): Promise<boolean> {
    let id: string | null = nodeId;
    const guard = new Set<string>();
    while (id) {
      if (id === ancestorId) return true;
      if (guard.has(id)) return false;
      guard.add(id);
      const row: { parent_id: string | null } | undefined = await this.db
        .selectFrom(SYSTEM_TABLES.assetFolders)
        .select('parent_id')
        .where('id', '=', id)
        .executeTakeFirst();
      id = row?.parent_id ?? null;
    }
    return false;
  }

  private async uniqueSlug(name: string, parentId: string | null, excludeId?: string): Promise<string> {
    let base = slugifyFilename(name).slug;
    if (!SLUG_RE.test(base)) base = 'folder';
    base = base.slice(0, 56);
    for (let i = 0; i < 50; i++) {
      const slug = i === 0 ? base : `${base}-${i + 1}`.slice(0, 64);
      let q = this.db.selectFrom(SYSTEM_TABLES.assetFolders).select('id').where('slug', '=', slug);
      q = parentId == null ? q.where('parent_id', 'is', null) : q.where('parent_id', '=', parentId);
      if (excludeId) q = q.where('id', '!=', excludeId);
      const hit = await q.executeTakeFirst();
      if (!hit) return slug;
    }
    throw new ConflictException('Could not allocate a unique folder slug');
  }
}
