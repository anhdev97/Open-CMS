// Base pages (spec §4, §6): a page framed by a base page's layout block. Pure and isomorphic: the website renderer
// and the admin page editor compose the same way.
import type { BlockManifest, PageLayout, StoredPageContent } from '@opencloudcms/schema';
import { isItem, isObj } from './content';
import { REGION_FIELD_PREFIX } from './define';
import type { BlockRegistry, PuckData } from './types';

/** Block kinds by name: the project manifest (`blockManifest`) or the registry itself. */
export type BlockKinds = BlockManifest | BlockRegistry;

type Def = { kind?: string; fields?: Record<string, unknown>; spec?: { tree?: unknown } };
const defOf = (m: BlockKinds, name: string): Def | undefined =>
  Array.isArray(m) ? (m as BlockManifest).find((b) => b.name === name) : (m as BlockRegistry).get(name);

/**
 * The page framed by its base page: the base's single root layout item, its `pageContent` = the page content and
 * each `region__<name>` filled by the page's region mode (`default` → the base's blocks, `replace` → the page's root
 * `region__<name>` blocks, `hide` → nothing). Regions are the layout item's `region__*` props (plus the registry's
 * declared region fields); region modes for other names are ignored. The page's `root` is kept without its
 * `region__*` props; zones are merged (the page's win).
 *
 * Returns `page` itself (same object) when `base` is null, `layout.baseId` is null, or the base content is not exactly
 * one layout block at root in the page's format version: the caller renders the page alone (and may warn).
 */
export function composeWithBase(base: StoredPageContent | null, page: StoredPageContent, layout: PageLayout, manifest: BlockKinds): StoredPageContent {
  if (!base || (layout && layout.baseId === null)) return page;
  if (base.format !== page.format || base.formatVersion !== page.formatVersion || !isObj(base.data)) return page;
  const items = Array.isArray(base.data.content) ? base.data.content : [];
  const frame = items[0];
  if (items.length !== 1 || !isItem(frame) || defOf(manifest, frame.type)?.kind !== 'layout') return page;

  const pageData = isObj(page.data) ? page.data : { root: { props: {} }, content: [] };
  const pageRoot = isObj(pageData.root) ? pageData.root : {};
  const pageRootProps = isObj(pageRoot.props) ? pageRoot.props : {};

  const regionKeys = new Set(Object.keys(frame.props).filter((k) => k.startsWith(REGION_FIELD_PREFIX)));
  const fields = defOf(manifest, frame.type)?.fields;
  if (isObj(fields)) for (const k of Object.keys(fields)) if (k.startsWith(REGION_FIELD_PREFIX)) regionKeys.add(k);

  const props: Record<string, unknown> = { ...frame.props, pageContent: Array.isArray(pageData.content) ? pageData.content : [] };
  for (const key of regionKeys) {
    const mode = layout?.regions?.[key.slice(REGION_FIELD_PREFIX.length)] ?? 'default';
    const from = mode === 'default' ? frame.props[key] : mode === 'replace' ? pageRootProps[key] : undefined;
    props[key] = Array.isArray(from) ? from : [];
  }

  const rootProps = Object.fromEntries(Object.entries(pageRootProps).filter(([k]) => !k.startsWith(REGION_FIELD_PREFIX)));
  const zones = { ...(isObj(base.data.zones) ? base.data.zones : {}), ...(isObj(pageData.zones) ? pageData.zones : {}) };
  return {
    ...page,
    data: {
      ...pageData,
      root: { ...pageRoot, props: rootProps },
      content: [{ ...frame, props }],
      ...(Object.keys(zones).length ? { zones: zones as Record<string, unknown[]> } : {}),
    },
  };
}

const isAction = (v: unknown) => isObj(v);
const specHasAction = (n: unknown): boolean =>
  isObj(n) && ((n.el === 'Button' && isObj(n.props) && isAction(n.props.action)) || (Array.isArray(n.children) && n.children.some(specHasAction)));

/**
 * Whether page data (stored content or Puck data) holds an overlay block or a button with an action, anywhere in
 * content, zones, root props and slot props (also list rows). Used to mount the client overlay route watcher only
 * where it is needed. Over-approximates: any item with an object `action` prop counts.
 */
export function containsInteractive(
  data: StoredPageContent | StoredPageContent['data'] | PuckData | null | undefined,
  manifest: BlockKinds,
): boolean {
  const o: unknown = data;
  if (!isObj(o)) return false;
  const d = isObj(o.data) && 'format' in o ? o.data : o;
  const specCache = new Map<string, boolean>();
  const interactive = (type: string): boolean => {
    let v = specCache.get(type);
    if (v === undefined) {
      const def = defOf(manifest, type);
      specCache.set(type, (v = def?.kind === 'overlay' || specHasAction(def?.spec?.tree)));
    }
    return v;
  };
  const visit = (value: unknown): boolean => {
    if (!Array.isArray(value)) return false;
    for (const el of value) {
      if (isItem(el)) {
        if (interactive(el.type) || isAction(el.props.action)) return true;
        if (Object.values(el.props).some(visit)) return true;
      } else if (isObj(el) && Object.values(el).some(visit)) return true;
    }
    return false;
  };
  if (visit(d.content)) return true;
  if (isObj(d.zones) && Object.values(d.zones).some(visit)) return true;
  const rootProps = isObj(d.root) ? d.root.props : undefined;
  return isObj(rootProps) && Object.values(rootProps).some(visit);
}
