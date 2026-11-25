'use client';

// Editor-only canvas renders for base pages and overlays (spec §5, decision 1): the base frame drawn around the page
// content (root `render` of the page editor) and overlay blocks as a labelled chip. The website is unchanged.
// Relative imports only (root vitest).
import { TriangleAlertIcon } from 'lucide-react';
import { createElement, useContext, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Render } from '@puckeditor/core';
import {
  composeWithBase,
  PUCK_FORMAT_VERSION,
  resolvePage,
  richTextFieldTransforms,
  toPuckConfig,
  type BlockDefinition,
  type BlockRegistry,
  type ContentFetcher,
  type CustomFieldRenderers,
  type PuckConfig,
  type PuckData,
  type StoredPageContent,
} from '@opencloudcms/core/blocks';
import { OVERLAY_NAME_RE, type Locale } from '@opencloudcms/schema';
import { t } from '../i18n';
import { frameRegionNames } from './base-fields';
import { BaseContext, type BaseFrameItem } from './editor-context';
import { REGION_PREFIX, rootPropsToLayout } from './field-logic';

type Props = Record<string, unknown>;
type Item = { type: string; props: Props };
const isObj = (v: unknown): v is Props => !!v && typeof v === 'object' && !Array.isArray(v);
const isItem = (v: unknown): v is Item => isObj(v) && typeof v.type === 'string' && isObj(v.props);

/** Prefix of the ids of base page items drawn in the editor: they never collide with the page's own item ids. */
export const BASE_ID_PREFIX = 'base-';

/** Copies of `items` with every item id (also in slots and list rows) prefixed. For display only, never saved. */
export function prefixItemIds<T extends Item>(items: readonly T[], prefix: string): T[] {
  const value = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(value);
    if (isItem(v)) return { ...v, props: props(v.props, true) };
    if (isObj(v)) return props(v, false);
    return v;
  };
  const props = (p: Props, own: boolean): Props => {
    const out: Props = {};
    for (const [k, v] of Object.entries(p)) out[k] = own && k === 'id' && typeof v === 'string' ? `${prefix}${v}` : Array.isArray(v) ? v.map(value) : v;
    return out;
  };
  return items.map((it) => value(it) as T);
}

export interface LoadedBaseFrame {
  status: 'ok' | 'invalid';
  frame: BaseFrameItem | null;
  regions: string[];
}

/**
 * The base page's layout block for the canvas: composed like the website (`composeWithBase`, every region with the
 * base's blocks), its data fields resolved (`resolvePage`) and its ids prefixed. `invalid` when the base content is
 * not one layout block at root in the current content format.
 */
export async function loadBaseFrame(
  content: unknown,
  registry: BlockRegistry,
  fetcher: ContentFetcher,
  o: { locale: Locale; defaultLocale: Locale },
): Promise<LoadedBaseFrame> {
  const invalid: LoadedBaseFrame = { status: 'invalid', frame: null, regions: [] };
  if (!isObj(content)) return invalid;
  const own: StoredPageContent = { format: 'puck', formatVersion: PUCK_FORMAT_VERSION, data: { root: { props: {} }, content: [] } };
  const composed = composeWithBase(content as unknown as StoredPageContent, own, null, registry);
  if (composed === own) return invalid;
  const resolved = await resolvePage(composed, registry, fetcher, o);
  const frame = resolved.content[0];
  if (!isItem(frame)) return invalid;
  const [unique] = prefixItemIds([frame], BASE_ID_PREFIX);
  return { status: 'ok', frame: unique!, regions: frameRegionNames(unique!, registry) };
}

const NO_FIELDS = {} as CustomFieldRenderers;
const configs = new WeakMap<BlockRegistry, Map<string, PuckConfig>>();

/** Render config of the base page's blocks (as on the website), overlay blocks shown as their chip. */
function baseRenderConfig(registry: BlockRegistry, locale: Locale): PuckConfig {
  let byLocale = configs.get(registry);
  if (!byLocale) configs.set(registry, (byLocale = new Map()));
  let c = byLocale.get(locale);
  if (!c) {
    c = toPuckConfig(registry, { locale, customFields: NO_FIELDS });
    for (const d of registry.list) {
      if (d.kind !== 'overlay') continue;
      const comp = c.components[d.name]!;
      const render = comp.render as unknown as (p: Props) => ReactElement;
      comp.render = ((p: Props) => createElement(OverlayChip, { def: d, props: p, render })) as never;
    }
    byLocale.set(locale, c);
  }
  return c;
}

/** Blocks of a base region shown as they are: rendered like the website, read-only and dimmed. */
function DefaultRegion({ name, items, config }: { name: string; items: unknown[]; config: PuckConfig }) {
  const data = useMemo(() => ({ root: { props: {} }, content: items }) as unknown as PuckData, [items]);
  return (
    <div data-base-region={name} className="pointer-events-none opacity-60">
      <Render config={config} data={data} fieldTransforms={richTextFieldTransforms as never} />
    </div>
  );
}

function HiddenRegion({ name }: { name: string }) {
  return (
    <div
      data-base-region-hidden={name}
      className="my-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border"
    >
      {t('pageEditor.base.hiddenRegion', { name })}
    </div>
  );
}

function BaseWarning() {
  return (
    <div data-base-warning="" role="status" className="m-2 inline-flex items-center gap-1 rounded-md border border-warning/50 bg-warning/10 px-2 py-1 text-xs text-warning">
      <TriangleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />
      {t('pageEditor.base.unavailable')}
    </div>
  );
}

/** Calls the layout block's own render with its slots given as nodes (the frame is never a Puck item of the page). */
function FrameRender({ def, props }: { def: BlockDefinition<any>; props: Props }) {
  return <>{def.render(props as never)}</>;
}

/**
 * Root `render` of the page editor (kind `page`): the chosen base page's layout block around the page content, from
 * `BaseContext` and the live root props (base choice, region modes and the `region__<name>` slots Puck passes).
 * Default regions: the base's blocks, read-only and dimmed; replaced regions: the root slot field (editable);
 * hidden regions: a thin labelled marker; `pageContent`: `children` (the page's drop zone). No base page: the page
 * alone; a base page that cannot be used: the page alone with a warning badge.
 */
export function BaseFrame(props: Props & { children?: ReactNode }) {
  const base = useContext(BaseContext);
  const { children } = props;
  const layout = rootPropsToLayout(props);
  const key = layout === null ? 'default' : layout.baseId;
  const registry = base.registry;
  const config = useMemo(() => (registry ? baseRenderConfig(registry, base.locale) : null), [registry, base.locale]);
  if (key === null || base.key !== key || base.status === 'none' || base.status === 'missing' || base.status === 'loading') return <>{children}</>;
  const def = base.frame && registry ? registry.get(base.frame.type) : undefined;
  if (base.status !== 'ok' || !base.frame || !def || !config) {
    return (
      <>
        <BaseWarning />
        {children}
      </>
    );
  }
  const modes = layout?.regions ?? {};
  const slots: Props = {};
  for (const r of base.regions) {
    const k = `${REGION_PREFIX}${r}`;
    const mode = modes[r] ?? 'default';
    if (mode === 'replace') {
      const Slot = props[k];
      slots[k] = typeof Slot === 'function' ? createElement(Slot as () => ReactElement) : null;
    } else if (mode === 'hide') slots[k] = <HiddenRegion name={r} />;
    else slots[k] = <DefaultRegion name={r} items={Array.isArray(base.frame.props[k]) ? (base.frame.props[k] as unknown[]) : []} config={config} />;
  }
  const frameProps = { ...base.frame.props, ...slots, pageContent: children, _locale: base.locale, _editor: true };
  return (
    <div data-base-frame={base.frame.type}>
      <FrameRender def={def} props={frameProps} />
    </div>
  );
}

/** What a layout block shows for `pageContent` on a base page's canvas. */
export function PageContentPlaceholder() {
  return (
    <div data-page-content-placeholder="" className="m-2 rounded-md border-2 border-dashed border-border p-8 text-center text-muted-foreground">
      <p className="text-sm font-medium">{t('pageEditor.base.pageContent')}</p>
      <p className="text-xs">{t('pageEditor.base.pageContentHint')}</p>
    </div>
  );
}

type OverlayDef = Pick<BlockDefinition<any>, 'fields'> & { spec?: { tree?: { props?: Props } } };

/** Name an overlay block opens under: its valid `name` prop, else the block's default name. */
function overlayName(def: OverlayDef, props: Props): string {
  if (typeof props.name === 'string' && OVERLAY_NAME_RE.test(props.name)) return props.name;
  const fallback = (def.fields as Record<string, { default?: unknown }>).name?.default;
  return typeof fallback === 'string' ? fallback : '';
}

/**
 * An overlay block on the editor canvas (a closed dialog takes no space): a chip "Overlay: <name> (Modal|Drawer)" with
 * a Preview toggle that shows its content inline (the dialog opened in place, not modal). Editor only.
 */
export function OverlayChip({ def, props, render }: { def: OverlayDef; props: Props; render: (p: Props) => ReactNode }) {
  const [preview, setPreview] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const variantProp = typeof props.variant === 'string' ? props.variant : def.spec?.tree?.props?.variant;
  const variant = variantProp === 'drawer' ? t('pageEditor.overlays.drawer') : t('pageEditor.overlays.modal');
  useEffect(() => {
    if (!preview) return;
    for (const d of box.current?.querySelectorAll('dialog') ?? []) {
      if (!d.hasAttribute('open')) d.setAttribute('open', '');
      d.style.position = 'static';
    }
  });
  return (
    <div data-overlay-chip={overlayName(def, props)} className="my-1">
      <div className="inline-flex items-center gap-2 rounded-full border border-dashed border-border bg-muted px-3 py-1 text-xs text-muted-foreground">
        <span>{t('pageEditor.overlays.chip', { name: overlayName(def, props), variant })}</span>
        <button type="button" className="font-medium underline underline-offset-2" aria-pressed={preview} onClick={() => setPreview((p) => !p)}>
          {preview ? t('pageEditor.overlays.hidePreview') : t('pageEditor.overlays.preview')}
        </button>
      </div>
      {preview ? <div ref={box}>{render(props)}</div> : null}
    </div>
  );
}
