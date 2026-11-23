import { Inject, Injectable } from '@nestjs/common';
import type { BlockManifest } from '@opencloudcms/schema';
import { OPENCLOUDCMS_OPTIONS, type ResolvedOpenCloudCmsOptions } from '../options';

type ManifestEntry = BlockManifest[number];

/**
 * The page block manifest the server checks pages against (publish hook, rich text normalization, blocks-check).
 * Starts as `pages.blocks` and is updated in place by the Block Builder API, so a block saved there can be used
 * without a restart. Without `pages.blocks` there is no manifest (no checks) and updates are ignored.
 */
@Injectable()
export class PageBlocksManifest {
  private manifest: BlockManifest | undefined;

  constructor(@Inject(OPENCLOUDCMS_OPTIONS) options: ResolvedOpenCloudCmsOptions) {
    const boot = options.pages?.blocks;
    this.manifest = boot ? boot.map((e) => ({ ...e })) : undefined;
  }

  current(): BlockManifest | undefined {
    return this.manifest;
  }

  /** Adds or replaces the entry of `entry.name` (a new array: readers holding the old one are not affected). */
  upsert(entry: ManifestEntry): void {
    if (!this.manifest) return;
    const i = this.manifest.findIndex((e) => e.name === entry.name);
    this.manifest = i >= 0 ? this.manifest.map((e, j) => (j === i ? { ...entry } : e)) : [...this.manifest, { ...entry }];
  }

  remove(name: string): void {
    if (!this.manifest) return;
    this.manifest = this.manifest.filter((e) => e.name !== name);
  }
}
