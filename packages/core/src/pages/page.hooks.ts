import { UnprocessableEntityException } from '@nestjs/common';
import { collectBlockNames, validatePagePath, type BlockManifest, type StoredPageContent } from '@opencloudcms/schema';
import type { HookRegistration } from '../options';

function checkPath(data: Record<string, unknown>): void {
  // A draft may omit the path (publish requires it); when present it must be valid.
  if (!('path' in data) || data.path == null || data.path === '') return;
  const r = validatePagePath(String(data.path));
  if (!r.ok) throw new UnprocessableEntityException({ code: r.code, message: r.message });
}

/** Block name -> occurrences for blocks of `content` that are not in `manifest`. */
export function unknownBlocks(content: unknown, manifest: BlockManifest): Map<string, number> {
  const known = new Set(manifest.map((b) => b.name));
  const out = new Map<string, number>();
  for (const [name, n] of collectBlockNames(content as StoredPageContent | null)) if (!known.has(name)) out.set(name, n);
  return out;
}

/** Registered by ContentRegistry for the core page type. Without a manifest, publishing never checks blocks. */
export function createPageHooks(manifest: BlockManifest | undefined): HookRegistration['hooks'] {
  return {
    beforeCreate: (data) => checkPath(data),
    beforeUpdate: (data) => checkPath(data),
    beforePublish: (doc, ctx) => {
      if (!manifest || ctx.force) return;
      const total = new Map<string, number>();
      for (const t of Object.values(doc.translations)) {
        for (const [name, n] of unknownBlocks(t.content, manifest)) total.set(name, (total.get(name) ?? 0) + n);
      }
      if (!total.size) return;
      throw new UnprocessableEntityException({
        code: 'unknown_block',
        message: `Page uses blocks that are not defined: ${[...total.keys()].join(', ')}`,
        issues: [...total].map(([name, n]) => ({ path: [name], message: String(n) })),
      });
    },
  };
}
