/**
 * Block Builder API (dev only): lists the page blocks of the project and saves / deletes composed block files
 * (`src/blocks/<kebab>/<kebab>.block.ts` + the managed `src/blocks/composed.ts`). The live manifest is updated so
 * that pages can use a saved block at once, without a restart. Eject turns a composed block into a hand-written
 * `.block.tsx` (`defineBlock`), which the builder no longer manages.
 */
import * as path from 'node:path';
import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  blocksDir,
  captureProjectFiles,
  ComposedBlockConflictError,
  composedBlockFile,
  ComposedBlockInvalidError,
  ComposedBlocksLoadError,
  ejectComposedBlock,
  EjectTargetExistsError,
  isComposedIndexWired,
  loadComposedBlocks,
  restoreProjectFiles,
  writeComposedBlocks,
} from '@opencloudcms/codegen';
import {
  CORE_BLOCK_NAMES,
  composedManifestEntry,
  isBreakingChange,
  validateComposedSpec,
  withAutoVersion,
  type ComposedBlockSpec,
  type ComposedIssue,
  type LocalizedText,
} from '@opencloudcms/schema';
import { OPENCLOUDCMS_OPTIONS, type ResolvedOpenCloudCmsOptions } from '../options';
import { detailPaths } from '../pages/detail';
import { PagesService } from '../pages/pages.service';
import { ContentRegistry } from '../registry.service';
import { SchemaBuilderService } from '../schema-builder';
import { SchemaWriteQueue } from '../schema-write-queue';
import { checkSpecAgainstTypes, composedBlockProblems } from './blocks-checks';
import { PageBlocksManifest } from './page-blocks-manifest';

export type BlockSource = 'core' | 'code' | 'composed';

export interface BlockListItem {
  name: string;
  /** The spec label for composed blocks; the block name for core and code blocks (the manifest has no labels). */
  label: LocalizedText | string;
  category: string | null;
  source: BlockSource;
  /** Project-relative path of the composed block file. */
  file?: string;
  version: number;
  /** Distinct page documents (draft or published, any locale) whose content uses the block. */
  usage: number;
  /** Composed blocks only: where the spec no longer fits the content types. */
  problems: string[];
}

const NAME_RE = /^[A-Z][A-Za-z0-9]{0,63}$/;

const invalid = (issues: ComposedIssue[], message = 'Invalid block') =>
  new UnprocessableEntityException({ code: 'invalid_block', message, issues });

const inUse = (name: string, pages: number) =>
  new ConflictException({
    code: 'block_in_use',
    message: `Block "${name}" is used by ${pages} page(s)`,
    issues: [{ path: [name], message: String(pages) }],
  });

@Injectable()
export class BlocksService {
  constructor(
    @Inject(OPENCLOUDCMS_OPTIONS) private readonly options: ResolvedOpenCloudCmsOptions,
    @Inject(ContentRegistry) private readonly registry: ContentRegistry,
    @Inject(SchemaWriteQueue) private readonly queue: SchemaWriteQueue,
    @Inject(PageBlocksManifest) private readonly manifest: PageBlocksManifest,
    @Inject(PagesService) private readonly pages: PagesService,
    @Inject(SchemaBuilderService) private readonly builder: SchemaBuilderService,
  ) {}

  private rel(p: string): string {
    return path.relative(this.options.config.root, p).split(path.sep).join('/');
  }

  /** True for core blocks and blocks written in code (in the manifest but not composed). */
  private isOtherBlock(name: string, composed: Set<string>): boolean {
    if (composed.has(name)) return false;
    return CORE_BLOCK_NAMES.includes(name) || (this.manifest.current() ?? []).some((m) => m.name === name);
  }

  /**
   * Error of the composed file of `name` (its own `src/blocks/<kebab>/<kebab>.block.ts`) when the loader could not
   * read it: such a block is still composed (a hand edit broke it) and may be fixed by saving it again.
   */
  private ownLoadError(name: string, errors: { file: string; message: string }[]) {
    if (!NAME_RE.test(name)) return undefined;
    const file = composedBlockFile(this.options.config, name);
    return errors.find((e) => e.file === file);
  }

  private toHttp(e: unknown): never {
    if (e instanceof ComposedBlockInvalidError) throw invalid(e.issues);
    if (e instanceof ComposedBlockConflictError) {
      throw new ConflictException({ code: 'block_name_taken', message: e.message });
    }
    if (e instanceof EjectTargetExistsError) {
      throw new ConflictException({ code: 'eject_target_exists', message: `${this.rel(e.file)} already exists; move it away first` });
    }
    if (e instanceof ComposedBlocksLoadError) {
      throw new ConflictException({
        code: 'composed_blocks_broken',
        message: 'Other composed block files are invalid; fix them first',
        issues: e.errors.map((x) => ({ path: [this.rel(x.file)], message: x.message })),
      });
    }
    throw e;
  }

  async list(): Promise<{ editable: boolean; composedIndexWired: boolean; data: BlockListItem[]; loadErrors: { file: string; message: string }[] }> {
    const config = this.options.config;
    const { specs, errors } = await loadComposedBlocks(config);
    const usage = await this.pages.blockUsage();
    const manifest = this.manifest.current() ?? [];
    const composed = new Map(specs.map((s) => [s.spec.name, s]));
    const problems = composedBlockProblems(specs.map((s) => s.spec), this.registry.all());
    const names = [...new Set([...manifest.map((m) => m.name), ...specs.map((s) => s.spec.name)])];
    const data = names.map((name): BlockListItem => {
      const c = composed.get(name);
      if (c) {
        return {
          name,
          label: c.spec.label,
          category: c.spec.category,
          source: 'composed',
          file: this.rel(c.file),
          version: c.spec.version,
          usage: usage.get(name) ?? 0,
          problems: problems[name] ?? [],
        };
      }
      const m = manifest.find((x) => x.name === name)!;
      const broken = this.ownLoadError(name, errors);
      if (broken) {
        return {
          name,
          label: name,
          category: null,
          source: 'composed',
          file: this.rel(broken.file),
          version: m.version,
          usage: usage.get(name) ?? 0,
          problems: [`file does not load: ${broken.message}`],
        };
      }
      return {
        name,
        label: name,
        category: null,
        source: CORE_BLOCK_NAMES.includes(name) ? 'core' : 'code',
        version: m.version,
        usage: usage.get(name) ?? 0,
        problems: [],
      };
    });
    return {
      editable: this.options.schemaEditable,
      composedIndexWired: isComposedIndexWired(config),
      data,
      loadErrors: errors.map((e) => ({ file: this.rel(e.file), message: e.message })),
    };
  }

  async get(name: string) {
    const config = this.options.config;
    const { specs, errors } = await loadComposedBlocks(config);
    const hit = specs.find((s) => s.spec.name === name);
    if (hit) {
      const usage = (await this.pages.blockUsage()).get(name) ?? 0;
      const problems = composedBlockProblems([hit.spec], this.registry.all())[name] ?? [];
      return { spec: hit.spec, file: this.rel(hit.file), usage, problems };
    }
    const own = this.ownLoadError(name, errors);
    if (own) this.toHttp(new ComposedBlocksLoadError([own]));
    if (this.isOtherBlock(name, new Set())) {
      throw new ConflictException({ code: 'not_composed', message: `Block "${name}" is not a composed block; edit it in code` });
    }
    throw new NotFoundException(`Unknown block "${name}"`);
  }

  save(name: string, body: { spec?: unknown; confirmBreaking?: boolean } | undefined) {
    this.builder.assertEditable();
    // `entryUrl` without a urlPattern needs a content type with a usable detail page (spec §4).
    const detailTypes = new Set(Object.keys(detailPaths(this.registry.all())));
    const issues = validateComposedSpec(body?.spec, { detailTypes });
    if (issues.length) throw invalid(issues);
    const spec = body!.spec as ComposedBlockSpec;
    const config = this.options.config;
    return this.queue.run(async () => {
      const { specs, errors } = await loadComposedBlocks(config);
      const byName = new Map(specs.map((s) => [s.spec.name, s.spec]));
      // Its own file is broken: still a composed block, which this save may replace.
      const brokenOwn = !byName.has(spec.name) && !!this.ownLoadError(spec.name, errors);
      const renamedFrom = specs.find((s) => s.spec.id === spec.id && s.spec.name !== spec.name);
      if ((spec.name !== name && byName.has(name)) || renamedFrom) {
        const from = renamedFrom?.spec.name ?? name;
        throw new UnprocessableEntityException({ code: 'name_immutable', message: `Block "${from}" cannot be renamed to "${spec.name}"` });
      }
      if (spec.name !== name) throw invalid([{ path: ['name'], message: `name must match the URL ("${name}")` }]);
      const prev = byName.get(spec.name) ?? null;
      const composedNames = new Set([...byName.keys(), ...(brokenOwn ? [spec.name] : [])]);
      if (this.isOtherBlock(spec.name, composedNames) || (prev && prev.id !== spec.id)) {
        throw new ConflictException({ code: 'block_name_taken', message: `A block named "${spec.name}" already exists` });
      }
      const typeIssues = checkSpecAgainstTypes(spec, this.registry.all());
      if (typeIssues.length) throw invalid(typeIssues, 'Block does not fit the content types');
      if (prev && body!.confirmBreaking !== true && isBreakingChange(prev, spec)) {
        const pages = (await this.pages.blockUsage()).get(spec.name) ?? 0;
        if (pages) throw inUse(spec.name, pages);
      }
      let next = withAutoVersion(prev, spec);
      if (brokenOwn) {
        // Unknown previous spec: keep at least the version pages were saved with.
        const live = (this.manifest.current() ?? []).find((m) => m.name === spec.name)?.version ?? 1;
        next = { ...next, version: Math.max(next.version, live) };
      }
      const extra = [blocksDir(config)];
      const before = captureProjectFiles(config, extra);
      try {
        const files = await writeComposedBlocks(config, { upsert: next });
        this.manifest.upsert(composedManifestEntry(next));
        return { spec: next, files: files.map((f) => this.rel(f)) };
      } catch (e) {
        restoreProjectFiles(config, before, extra);
        this.toHttp(e);
      }
    });
  }

  remove(name: string, force: boolean) {
    this.builder.assertEditable();
    const config = this.options.config;
    return this.queue.run(async () => {
      const { specs, errors } = await loadComposedBlocks(config);
      const exists = specs.some((s) => s.spec.name === name) || !!this.ownLoadError(name, errors);
      if (!exists) {
        if (this.isOtherBlock(name, new Set())) {
          throw new ConflictException({ code: 'not_composed', message: `Block "${name}" is not a composed block; remove it in code` });
        }
        throw new NotFoundException(`Unknown block "${name}"`);
      }
      if (!force) {
        const pages = (await this.pages.blockUsage()).get(name) ?? 0;
        if (pages) throw inUse(name, pages);
      }
      const extra = [blocksDir(config)];
      const before = captureProjectFiles(config, extra);
      try {
        const files = await writeComposedBlocks(config, { removeName: name });
        this.manifest.remove(name);
        return { files: files.map((f) => this.rel(f)) };
      } catch (e) {
        restoreProjectFiles(config, before, extra);
        this.toHttp(e);
      }
    });
  }

  /**
   * Ejects a composed block to TSX: writes `<kebab>.block.tsx` next to its file (same name, version, fields and
   * rendering; `usesLocale: true`), removes the `.block.ts` and regenerates `composed.ts`. `src/blocks/index.ts` is
   * not edited: the caller adds `importLine` there. The live manifest entry stays as it is (same name and version).
   */
  eject(name: string) {
    this.builder.assertEditable();
    const config = this.options.config;
    return this.queue.run(async () => {
      const { specs, errors } = await loadComposedBlocks(config);
      const hit = specs.find((s) => s.spec.name === name);
      if (!hit) {
        const own = this.ownLoadError(name, errors);
        if (own) this.toHttp(new ComposedBlocksLoadError([own]));
        if (this.isOtherBlock(name, new Set())) {
          throw new ConflictException({ code: 'not_composed', message: `Block "${name}" is not a composed block` });
        }
        throw new NotFoundException(`Unknown block "${name}"`);
      }
      const extra = [blocksDir(config)];
      const before = captureProjectFiles(config, extra);
      try {
        const r = await ejectComposedBlock(config, hit.spec, hit.file);
        return { file: this.rel(r.file), importLine: r.importLine, files: r.touched.map((f) => this.rel(f)) };
      } catch (e) {
        restoreProjectFiles(config, before, extra);
        this.toHttp(e);
      }
    });
  }
}
