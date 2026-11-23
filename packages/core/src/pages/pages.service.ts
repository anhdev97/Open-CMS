import { BadRequestException, Inject, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { fieldStorage, l10nTable, mainTable, PAGE_API_ID, type BlockManifest } from '@opencloudcms/schema';
import { EntriesService } from '../entries.service';
import { OPENCLOUDCMS_DB, OPENCLOUDCMS_OPTIONS, type ResolvedOpenCloudCmsOptions } from '../options';
import { ContentRegistry } from '../registry.service';
import { unknownBlocks } from './page.hooks';
import { shadowedPagePaths } from './shadowed';

export interface BlocksCheckItem {
  documentId: string;
  locale: string;
  title: string | null;
  unknown: string[];
}

@Injectable()
export class PagesService implements OnModuleInit {
  private readonly logger = new Logger('OpenCloudCms');
  private shadowedPaths: string[] = [];

  constructor(
    @Inject(EntriesService) private readonly entries: EntriesService,
    @Inject(ContentRegistry) private readonly registry: ContentRegistry,
    @Inject(OPENCLOUDCMS_OPTIONS) private readonly options: ResolvedOpenCloudCmsOptions,
    @Inject(OPENCLOUDCMS_DB) private readonly db: Kysely<any>,
  ) {}

  onModuleInit(): void {
    const web = this.options.web;
    // Computed once at boot: file routes only change with a code change (and a restart).
    this.shadowedPaths = web?.enabled === false ? [] : shadowedPagePaths(web?.dir ?? process.cwd());
    if (!this.options.pages?.blocks) {
      this.logger.warn('pages.blocks is not set: publishing pages does not check for unknown blocks. Pass the project block manifest as `pages: { blocks }` to OpenCloudCmsModule.forRoot.');
    }
  }

  /** The page of `locale` (exact, no fallback) whose path is `path`. 404 when absent. */
  async byPath(status: 'draft' | 'published', path: string | undefined, locale: string | undefined) {
    if (!path) throw new BadRequestException('Query parameter "path" is required');
    const loc = locale || this.options.config.defaultLocale;
    const { data } = await this.entries.list(PAGE_API_ID, { status, locale: loc, filter: { path }, limit: 1 });
    // The list falls back to the default locale for display; by-path must match the requested locale only.
    const hit = data.find((d) => d.locale === loc);
    if (!hit) throw new NotFoundException(`No page at ${path}`);
    return { data: hit };
  }

  /** Static paths of the website's own file routes (`app/(site)/**\/page.*`): Next serves them before any page built here. */
  shadowed(): { data: string[] } {
    return { data: [...this.shadowedPaths] };
  }

  /** Pages (drafts and published, per locale) that use blocks missing from the manifest. */
  async blocksCheck(): Promise<{ data: BlocksCheckItem[]; manifest: BlockManifest | null }> {
    const manifest = this.options.pages?.blocks ?? null;
    if (!manifest) return { data: [], manifest: null };
    const def = this.registry.get(PAGE_API_ID);
    const col = (name: string) => {
      const field = def.fields.find((f) => f.name === name)!;
      const s = fieldStorage(def, field);
      if (s.mode !== 'columns') throw new Error(`${name} is not a column field`);
      return s.columns[0].name;
    };
    const rows = await sql<{ document_id: string; status: string; locale: string; title: string | null; content: unknown }>`
      select m.document_id, m.status, l.locale, l.${sql.ref(col('title'))} as title, l.${sql.ref(col('content'))} as content
      from ${sql.table(mainTable(def))} m join ${sql.table(l10nTable(def))} l on l.entry_id = m.id
      order by m.document_id, l.locale, m.status`.execute(this.db);
    // Draft first (its title is what the editor shows), published merged in.
    const out = new Map<string, BlocksCheckItem>();
    for (const r of rows.rows.sort((a, b) => (a.status === b.status ? 0 : a.status === 'draft' ? -1 : 1))) {
      const unknown = [...unknownBlocks(r.content, manifest).keys()];
      const key = `${r.document_id}|${r.locale}`;
      const cur = out.get(key);
      if (cur) cur.unknown = [...new Set([...cur.unknown, ...unknown])];
      else out.set(key, { documentId: r.document_id, locale: r.locale, title: r.title, unknown });
    }
    const data = [...out.values()].filter((i) => i.unknown.length).map((i) => ({ ...i, unknown: i.unknown.sort() }));
    data.sort((a, b) => (a.documentId + a.locale).localeCompare(b.documentId + b.locale));
    return { data, manifest };
  }
}
