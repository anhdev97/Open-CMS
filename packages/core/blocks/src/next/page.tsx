import { cache, type ReactNode } from 'react';
import type { Metadata } from 'next';
import { cookies, draftMode, headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { Render } from '@puckeditor/core/rsc';
import { PAGE_API_ID, validatePageLayout, type Locale, type PageLayout, type StoredPageContent } from '@opencloudcms/schema';
import { composeWithBase, containsInteractive } from '../base-page';
import { isItem, isObj, mapData, mapSlots, readPageContent, type ItemFn } from '../content';
import { adminFetcher, FetchError, publicFetcher } from '../fetchers';
import { toPuckConfig } from '../puck-config';
import { resolvePage, type ContentFetcher } from '../resolve';
import { richTextFieldTransforms } from '../richtext-render';
import type { BlockRegistry, CustomFieldRenderers, PuckConfig, PuckData } from '../types';
import { PreviewBar, type PreviewBarVariant } from './PreviewBar';
import { OverlayRouteWatcher } from './overlay-route-watcher';
import { Welcome } from './Welcome';
import { PREVIEW_LOCALE_COOKIE, asLocale, copyLocale, isPagePath, resolveBaseUrl } from './shared';

export type CmsPageProps = { params: Promise<{ path?: string[] }> };

export type CreateCmsPageOptions = {
  blocks: BlockRegistry;
  /**
   * Loopback URL of the API. Default `http://127.0.0.1:${process.env.PORT ?? 4000}`.
   * In draft mode the visitor's request cookies (the admin session) are forwarded to this URL, so it must be this
   * server itself (loopback or the site's own origin), never another host.
   */
  baseUrl?: string;
  /** Heading of the welcome page shown at `/` while no page is published there. */
  siteName?: string;
};

type PageEntry = { documentId: string; locale?: unknown; title?: unknown; path?: unknown; seo?: unknown; content?: unknown; layout?: unknown };
type Bar = { variant: PreviewBarVariant; locale: Locale };
type Loaded =
  | {
      found: true;
      draft: boolean;
      entry: PageEntry;
      locale: Locale;
      defaultLocale: Locale;
      fetcher: ContentFetcher;
      /** API base URL and, in draft mode, the session cookie: the base page is fetched the same way as the page. */
      api: string;
      cookie?: string;
      bar?: Bar;
    }
  | { found: false; draft: boolean; locale: Locale; bar?: Bar };

/** Puck's `Render` only uses component `render` and the field types (slots, richtext); the editor-only custom field UIs are never called. */
const NONE = (() => null) as never;
const RENDER_ONLY_FIELDS: CustomFieldRenderers = { link: NONE, image: NONE, entry: NONE, entries: NONE };

/** Unknown stored blocks render nothing; each name is logged once per process (spec §6.5). */
const warnedUnknown = new Set<string>();
function warnUnknownBlocks(data: PuckData, r: BlockRegistry): void {
  const visit: ItemFn = (item) => {
    if (!isItem(item)) return item;
    const def = r.get(item.type);
    if (!def) {
      if (!warnedUnknown.has(item.type)) {
        warnedUnknown.add(item.type);
        console.warn(`[OpenCloudCMS] Block "${item.type}" is stored in a page but not defined in the project blocks; it is not rendered.`);
      }
      return item;
    }
    mapSlots(def.fields, item.props, visit);
    return item;
  };
  mapData(data as unknown as Record<string, unknown>, visit);
}

/** Content stored in another format version is not rendered (the editor shows it read-only); logged once per page. */
const warnedMigration = new Set<string>();
function warnNeedsMigration(documentId: string, locale: Locale): void {
  const key = `${documentId}:${locale}`;
  if (warnedMigration.has(key)) return;
  warnedMigration.add(key);
  console.warn(
    `[OpenCloudCMS] Page ${documentId} (${locale}) is stored in another content format version and needs migration; its body is not rendered.`,
  );
}

/** A base page that cannot frame its pages: logged once per base id (or `default`) and reason per process. */
const warnedBase = new Set<string>();
function warnBase(id: string, why: string): void {
  const key = `${id}:${why}`;
  if (warnedBase.has(key)) return;
  warnedBase.add(key);
  console.warn(`[OpenCloudCMS] Base page ${id} ${why}; pages it frames are rendered without it.`);
}

/** Which base frames the page: `layout` null/absent → the default base, `baseId: null` → none. */
function baseIdOf(layout: unknown): string | null {
  if (layout == null || !validatePageLayout(layout).ok) return 'default';
  return (layout as Exclude<PageLayout, null>).baseId;
}

const EMPTY_CONTENT = (formatVersion: number): StoredPageContent => ({ format: 'puck', formatVersion, data: { root: { props: {} }, content: [] } });

/** `undefined` → `/`; anything that is not a valid page path → null (never sent to the API). */
function toPath(segments: string[] | undefined): string | null {
  const path = '/' + (segments ?? []).join('/');
  return isPagePath(path) ? path : null;
}

type Got = { status: number; body: unknown };
async function getJson(url: string, init: { cookie?: string; noStore: boolean }): Promise<Got> {
  const h: Record<string, string> = { accept: 'application/json' };
  if (init.cookie) h.cookie = init.cookie;
  const res = await fetch(url, { headers: h, ...(init.noStore ? { cache: 'no-store' as const } : {}) });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, body };
}

function fail(what: string, g: Got): never {
  const b = g.body as { error?: { message?: string }; message?: string } | null;
  throw new FetchError(`OpenCloudCMS: ${what} failed with ${g.status}: ${b?.error?.message ?? b?.message ?? ''}`.trim(), g.status);
}

const entryOf = (g: Got): PageEntry | undefined => {
  const d = (g.body as { data?: unknown } | null)?.data;
  return isObj(d) ? (d as PageEntry) : undefined;
};

const byPathUrl = (base: string, prefix: string, path: string, locale?: Locale): string => {
  const qs = new URLSearchParams({ path });
  if (locale) qs.set('locale', locale);
  return `${base}${prefix}/${PAGE_API_ID}/by-path?${qs}`;
};

/**
 * Website renderer for `app/(site)/[[...path]]/page.tsx` (spec §8.2 step 3–5, §10).
 * - Draft mode off: the published page of the default locale from the public API (`/` without a page → welcome page,
 *   any other missing path → `notFound()`).
 * - Draft mode on: the admin API with the request's session cookie, in the preview locale, data blocks resolved with
 *   the same session (drafts of entries); every fetch is `no-store`. If the admin API says 401/403, the published page
 *   is rendered with the "session expired" bar: a draft is never shown without a valid session.
 */
export function createCmsPage(o: CreateCmsPageOptions): {
  Page(props: CmsPageProps): Promise<ReactNode>;
  generateMetadata(props: CmsPageProps): Promise<Metadata>;
} {
  const configs = new Map<Locale, PuckConfig>();
  const configFor = (locale: Locale): PuckConfig => {
    let c = configs.get(locale);
    if (!c) configs.set(locale, (c = toPuckConfig(o.blocks, { locale, customFields: RENDER_ONLY_FIELDS })));
    return c;
  };

  async function loadPublic(base: string, path: string, acceptLanguage: string | null): Promise<Loaded> {
    // No locale: the API answers in the default locale, the only one served publicly (spec §7).
    const g = await getJson(byPathUrl(base, '/api/content', path), { noStore: false });
    if (g.status === 404) return { found: false, draft: false, locale: copyLocale(acceptLanguage) };
    const entry = g.status === 200 ? entryOf(g) : undefined;
    const locale = asLocale(entry?.locale);
    if (!entry || !locale) fail(`GET page ${path}`, g);
    return { found: true, draft: false, entry, locale, defaultLocale: locale, fetcher: publicFetcher(base), api: base };
  }

  /** `null` = the session is missing, expired or lacks `content.read`. */
  async function loadDraft(base: string, path: string, cookie: string): Promise<Loaded | null> {
    const opts = { cookie, noStore: true };
    const meta = await getJson(`${base}/api/admin/meta`, opts);
    if (meta.status === 401 || meta.status === 403) return null;
    const m = meta.body as { defaultLocale?: unknown; locales?: unknown } | null;
    const defaultLocale = asLocale(m?.defaultLocale);
    if (meta.status !== 200 || !defaultLocale) fail('GET /api/admin/meta', meta);
    const enabled = Array.isArray(m?.locales) ? m.locales.filter((l): l is Locale => asLocale(l) !== undefined) : [];
    const wanted = asLocale((await cookies()).get(PREVIEW_LOCALE_COOKIE)?.value);
    const locale = wanted && enabled.includes(wanted) ? wanted : defaultLocale;
    const bar: Bar = { variant: 'draft', locale };

    const g = await getJson(byPathUrl(base, '/api/admin/content', path, locale), opts);
    if (g.status === 401 || g.status === 403) return null;
    if (g.status === 404) return { found: false, draft: true, locale, bar };
    const entry = g.status === 200 ? entryOf(g) : undefined;
    if (!entry) fail(`GET draft page ${path}`, g);
    return { found: true, draft: true, entry, locale, defaultLocale, fetcher: adminFetcher(base, { cookie }), api: base, cookie, bar };
  }

  async function load(path: string): Promise<Loaded> {
    const base = resolveBaseUrl(o.baseUrl);
    const h = await headers();
    const acceptLanguage = h.get('accept-language');
    if ((await draftMode()).isEnabled) {
      const draft = await loadDraft(base, path, h.get('cookie') ?? '');
      if (draft) return draft;
      const published = await loadPublic(base, path, acceptLanguage);
      return { ...published, bar: { variant: 'expired', locale: copyLocale(acceptLanguage) } };
    }
    return loadPublic(base, path, acceptLanguage);
  }
  // Per request (React server `cache`): generateMetadata and Page share one load.
  const loadOnce = cache(load);

  /**
   * Stored content of the base page `id` (a document id or `default`) in `locale` (the API falls back to the default
   * locale): published, or with `cookie` the draft (same session as the page). `null` when there is none or it cannot
   * be used: a missing default base is silent, anything else is logged once.
   */
  async function loadBase(api: string, id: string, locale: Locale, cookie: string | undefined): Promise<StoredPageContent | null> {
    const draft = cookie !== undefined;
    const qs = new URLSearchParams({ id, locale });
    let g: Got;
    try {
      g = await getJson(`${api}${draft ? '/api/admin/content' : '/api/content'}/${PAGE_API_ID}/base?${qs}`, { cookie, noStore: draft });
    } catch (e) {
      warnBase(id, `could not be loaded (${(e as Error).message})`);
      return null;
    }
    if (g.status === 404 && id === 'default') return null;
    if (g.status === 404) {
      warnBase(id, draft ? 'does not exist' : 'does not exist or is not published');
      return null;
    }
    const entry = g.status === 200 ? entryOf(g) : undefined;
    if (!entry) {
      warnBase(id, `could not be loaded (status ${g.status})`);
      return null;
    }
    const read = readPageContent(entry.content ?? null, o.blocks);
    if (read.status !== 'ok') {
      warnBase(id, read.status === 'empty' ? 'has no content' : 'is stored in another content format version and needs migration');
      return null;
    }
    return entry.content as StoredPageContent;
  }
  const loadBaseOnce = cache(loadBase);

  async function Page({ params }: CmsPageProps): Promise<ReactNode> {
    // Always rendered per request: the page is data, and draft mode / sessions are checked on every request.
    await connection();
    const path = toPath((await params).path);
    if (!path) notFound();
    const r = await loadOnce(path);
    const bar = r.bar ? <PreviewBar variant={r.bar.variant} locale={r.bar.locale} path={path} /> : null;
    if (!r.found) {
      if (path !== '/') notFound();
      return (
        <>
          <Welcome locale={r.locale} siteName={o.siteName} />
          {bar}
        </>
      );
    }
    let body: ReactNode = null;
    if (readPageContent(r.entry.content ?? null, o.blocks).status === 'needs-migration') {
      warnNeedsMigration(r.entry.documentId, r.locale);
    } else {
      let content = (r.entry.content ?? null) as StoredPageContent;
      const baseId = baseIdOf(r.entry.layout);
      const base = baseId ? await loadBaseOnce(r.api, baseId, r.locale, r.cookie) : null;
      if (base && baseId) {
        const own = isObj(content) && Object.keys(content).length ? content : EMPTY_CONTENT(base.formatVersion);
        const composed = composeWithBase(base, own, r.entry.layout as PageLayout, o.blocks);
        if (composed === own) warnBase(baseId, 'is not one layout block at its root');
        else content = composed;
      }
      // Data blocks of the base regions and of the page are resolved together.
      const data = await resolvePage(content, o.blocks, r.fetcher, {
        locale: r.locale,
        defaultLocale: r.defaultLocale,
      });
      warnUnknownBlocks(data, o.blocks);
      body = (
        <>
          <Render config={configFor(r.locale)} data={data} fieldTransforms={richTextFieldTransforms} />
          {containsInteractive(data, o.blocks) ? <OverlayRouteWatcher /> : null}
        </>
      );
    }
    return (
      <>
        <main data-opencloudcms-site="" lang={r.locale}>
          {body}
        </main>
        {bar}
      </>
    );
  }

  async function generateMetadata({ params }: CmsPageProps): Promise<Metadata> {
    const path = toPath((await params).path);
    if (!path) return {};
    const r = await loadOnce(path);
    const noindexDraft = { index: false, follow: false };
    if (!r.found) return r.draft ? { robots: noindexDraft } : {};
    const seo = isObj(r.entry.seo) ? r.entry.seo : {};
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);
    const meta: Metadata = {};
    const title = str(seo.title) ?? str(r.entry.title);
    if (title) meta.title = title;
    const description = str(seo.description);
    if (description) meta.description = description;
    const image = str(seo.image) ?? (isObj(seo.image) ? str(seo.image.src) : undefined);
    if (image) meta.openGraph = { images: [image] };
    if (r.draft) meta.robots = noindexDraft;
    else if (seo.noindex === true) meta.robots = { index: false };
    return meta;
  }

  return { Page, generateMetadata };
}
