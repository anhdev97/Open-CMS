// Canvas renders of the block builder. Every element is drawn by `defineComposedBlock` (the renderer of pages and
// the website) with the sample entry and `_locale`/`_editor` stamped, so the canvas looks like the page builder.
// Containers draw their Puck slot with the same layout classes and variables (`ui.layoutClass` / `ui.layoutStyle`).
// Components are `inline`: each render draws the item frame itself (Puck's drag ref). The frame is the box the parent
// lays out, so it carries what the element's own box carries on the site toward its parent: `span`, margin (a
// `margin-left: auto` pushing a nav to the right of a Stack) and width/max-width (percentages of the parent); the
// element keeps its other style and fills the frame. Elements hidden at the edited breakpoint stay drawn, dimmed.
// The component elements (spec §3 "Canvas visibility", block builder only) draw the website's `ui` components with
// their Puck slot inside and the `editor` overrides set from the selection: a Dropdown panel / Tooltip bubble open
// while it or something inside is selected, Tabs showing the selected TabPanel, Accordion items open and a static
// Carousel whose slides (the slot's items) sit side by side. The page builder and the website never set them.
import {
  createContext, createElement, useContext, useEffect, useMemo, useState,
  type CSSProperties, type MouseEvent, type ReactElement, type ReactNode,
} from 'react';
import { createUsePuck, useGetPuck, type SlotComponent } from '@puckeditor/core';
import { composedHelpers, defineComposedBlock, ui, type ComposedBlockDefinition } from '@opencloudcms/core/blocks';
import {
  INTERACTIVE_ELEMENTS, isClickable, resolveResponsive, validateComposedSpec,
  type Breakpoint, type ComposedBinding, type ComposedElement, type ComposedNode, type HoverStyle, type NodeStyle, type Responsive,
} from '@opencloudcms/schema';
import { t } from '../i18n';
import { CanvasContext, CanvasSelection, HoverPreview, type CanvasItem, type CanvasModel, type CanvasSelectionModel } from './context';
import { useBreakpoint } from './style/breakpoint';
import { bpLabel } from './style/shared';
import { CHILD_ITEM, elementLabel, slotRules } from './element-config';
import { templatesRefused } from './templates';
import { indexPuck, itemToNode, pathOf, type BuilderPuckData, type PuckItem } from './tree-puck';

type Props = Record<string, unknown>;
const PUCK_RENDER_KEYS = new Set(['puck', 'editMode', 'children']);

/** A single-entry view of the binding: what one item of the template is drawn with. */
function previewBinding(b: ComposedBinding | undefined): ComposedBinding | undefined {
  return b ? { apiId: b.apiId, mode: 'single', ...(b.urlPattern ? { urlPattern: b.urlPattern } : {}) } : undefined;
}

// Definitions by spec JSON: validation runs once per distinct node, not on every render.
const defs = new Map<string, ComposedBlockDefinition | Error>();
function definition(c: CanvasModel, tree: ComposedNode): ComposedBlockDefinition | Error {
  const spec = {
    id: 'blk_preview',
    name: 'BuilderPreview',
    label: { 'en-US': 'Preview' },
    category: 'preview',
    version: 1,
    fields: c.fields,
    ...(c.binding ? { binding: previewBinding(c.binding) } : {}),
    tree,
  };
  const key = JSON.stringify(spec);
  let d = defs.get(key);
  if (!d) {
    try {
      d = defineComposedBlock(spec as never);
    } catch (e) {
      d = e instanceof Error ? e : new Error(String(e));
    }
    if (defs.size > 500) defs.clear();
    defs.set(key, d);
  }
  return d;
}

function renderWith(c: CanvasModel, d: ComposedBlockDefinition, entry: unknown): ReactNode {
  return d.render({ ...c.fieldValues, entry, _locale: c.locale, _editor: true } as never) as ReactNode;
}

function Hint({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'warning' }) {
  return (
    <div
      className={`rounded-md border border-dashed px-3 py-2 text-center text-xs ${tone === 'warning' ? 'border-warning text-warning' : 'text-muted-foreground'}`}
    >
      {children}
    </div>
  );
}

/** Whether `showIf` holds for the current sample (hidden elements stay visible, dimmed, so they can be edited). */
function shown(c: CanvasModel, n: ComposedNode): boolean {
  const s = n.showIf;
  if (!s) return true;
  const v = s.from === 'entry' ? (c.entry as Props | null)?.[s.path ?? ''] : c.fieldValues[s.name ?? ''];
  return composedHelpers.present(v) === (s.is === 'present');
}

/** Dimmed element (kept editable) with every reason it is hidden; `fill` keeps a relative height's `h-full` chain. */
function Dim({ reasons, fill, children }: { reasons: (string | false)[]; fill: boolean; children: ReactNode }) {
  const why = reasons.filter((r): r is string => !!r);
  if (!why.length) return <>{children}</>;
  return (
    <div className={fill ? 'h-full opacity-40' : 'opacity-40'} title={why.join('; ')}>
      {children}
    </div>
  );
}

const isObj = (v: unknown): v is Props => !!v && typeof v === 'object' && !Array.isArray(v);
/** Style keys drawn on the item frame (the box the parent lays out). */
const FRAME_KEYS = ['margin', 'width', 'maxWidth', 'span'] as const;

/** A width moved to the frame: the element fills it (`100%`), or keeps `auto` where it is `auto`. */
function fill(width: unknown): unknown {
  const one = (w: unknown) => (w === 'auto' ? 'auto' : '100%');
  return isObj(width) ? Object.fromEntries(Object.entries(width).map(([bp, w]) => [bp, one(w)])) : one(width);
}

/**
 * Canvas split of a node's style: `frame` (margin, width, max-width, span) for the item frame, `inner` (the rest,
 * without `hidden`, and a filling width) for the element, and whether `hidden` hides it at breakpoint `bp`.
 */
export function canvasStyle(style: NodeStyle | undefined, bp: Breakpoint): { frame: NodeStyle | undefined; inner: NodeStyle | undefined; hidden: boolean } {
  if (!isObj(style)) return { frame: undefined, inner: undefined, hidden: false };
  const frame: Props = {};
  const inner: Props = {};
  for (const [k, v] of Object.entries(style)) {
    if (v === undefined || k === 'hidden') continue;
    if ((FRAME_KEYS as readonly string[]).includes(k)) frame[k] = v;
    else inner[k] = v;
  }
  if (frame.width !== undefined) inner.width = fill(frame.width);
  const hidden = isObj(style.hidden) && style.hidden[bp] === true;
  const some = (o: Props) => (Object.keys(o).length ? (o as NodeStyle) : undefined);
  return { frame: some(frame), inner: some(inner), hidden };
}

const hiddenTitle = (bp: Breakpoint) => t('blockBuilder.canvas.hiddenAt', { bp: bpLabel(bp) });

function nodeOf(el: ComposedElement, props: Props): ComposedNode {
  const clean: Props = { id: '' };
  for (const [k, v] of Object.entries(props)) if (!PUCK_RENDER_KEYS.has(k)) clean[k] = v;
  return itemToNode({ type: el, props: clean } as PuckItem);
}

/** A style drawn with its hover colours as its colours ("Show hover" of the style panel). */
export function withHover(style: NodeStyle | undefined): NodeStyle | undefined {
  if (!isObj(style) || !isObj(style.hover)) return style;
  const { hover, ...rest } = style;
  const h = hover as HoverStyle;
  return {
    ...rest,
    ...(h.background !== undefined ? { background: h.background } : {}),
    ...(h.color !== undefined ? { color: h.color } : {}),
    ...(h.borderColor !== undefined ? { borderColor: h.borderColor } : {}),
  };
}

/** The node of a canvas item, with its hover colours drawn when "Show hover" is on for it. */
function useNode(el: ComposedElement, props: Props): ComposedNode {
  const hover = useContext(HoverPreview);
  const node = nodeOf(el, props);
  return hover.id !== null && hover.id === props.id && node.style ? { ...node, style: withHover(node.style) } : node;
}

function LeafPreview({ el, props }: { el: ComposedElement; props: Props }) {
  const c = useContext(CanvasContext);
  const bp = useBreakpoint();
  const node = useNode(el, props);
  const { showIf, style, ...rest } = node;
  const cs = canvasStyle(style, bp);
  const bare: ComposedNode = cs.inner ? { ...rest, style: cs.inner } : rest;
  const d = definition(c, bare);
  let out: ReactNode = null;
  if (d instanceof Error) out = <Hint tone="warning">{t('blockBuilder.canvas.invalid', { element: elementLabel(el) })}</Hint>;
  else out = renderWith(c, d, c.entry);
  if (out === null || out === undefined || out === false) out = <Hint>{t('blockBuilder.canvas.empty', { element: elementLabel(el) })}</Hint>;
  const bySample = !shown(c, { ...bare, ...(showIf ? { showIf } : {}) });
  return (
    <Dim reasons={[cs.hidden && hiddenTitle(bp), bySample && t('blockBuilder.canvas.hiddenBySample')]} fill={relativeHeight(style)}>
      {out}
    </Dim>
  );
}

function SlotPreview({ props }: { props: Props }) {
  const allow = Array.isArray(props.allow) ? (props.allow as string[]) : [];
  return (
    <div className="rounded-xl border-2 border-dashed border-primary/40 p-6 text-center text-sm text-muted-foreground">
      <p>{t('blockBuilder.canvas.slot')}</p>
      {allow.length > 0 && <p className="mt-1 text-xs">{t('blockBuilder.canvas.slotAllow', { blocks: allow.join(', ') })}</p>}
    </div>
  );
}

type LayoutEl = 'Box' | 'Stack' | 'Columns' | 'Grid' | 'Card';

function ContainerPreview({ el, props }: { el: LayoutEl; props: Props }) {
  const c = useContext(CanvasContext);
  const bp = useBreakpoint();
  const Slot = props.children as SlotComponent | undefined;
  const node = useNode(el, props);
  const cs = canvasStyle(node.style, bp);
  const p = { ...props, direction: props.direction ?? 'vertical', style: cs.inner };
  const cls = (ui.layoutClass[el] as (p: Props) => string)(p);
  const style = (ui.layoutStyle[el] as (p: Props) => CSSProperties | undefined)(p);
  // A clickable Box/Card (bound href or an action) refuses interactive elements while it is one (spec §1).
  const clickable = isClickable(node)
    ? { disallow: [...(slotRules(el, c.binding?.mode === 'collection').disallow ?? []), ...INTERACTIVE_ELEMENTS, ...templatesRefused([], INTERACTIVE_ELEMENTS)] }
    : {};
  const zone = Slot ? createElement(Slot, { className: cls, style, minEmptyHeight: 64, ...clickable } as never) : <div className={cls} style={style} />;
  return (
    <Dim reasons={[cs.hidden && hiddenTitle(bp), !shown(c, node) && t('blockBuilder.canvas.hiddenBySample')]} fill={relativeHeight(props.style as NodeStyle | undefined)}>
      {zone}
    </Dim>
  );
}

/** Whether a style height is relative at some breakpoint (the frame must then fill its cell: `h-full`). */
function relativeHeight(style: NodeStyle | undefined): boolean {
  return Object.values(resolveResponsive(style?.height)).some((h) => typeof h === 'string' && h.endsWith('%'));
}

/**
 * The item frame Puck drags: carries the element's column span, margin, width and max-width (see `canvasStyle`)
 * and, for a relative height, `h-full`.
 */
export function frameAttrs(style: NodeStyle | undefined): { className?: string; style?: CSSProperties } {
  const own = canvasStyle(style, 'base').frame;
  const sp = own ? ui.styleProps(own) : null;
  const className = [sp?.className, relativeHeight(style) ? 'h-full' : ''].filter(Boolean).join(' ');
  return {
    ...(className ? { className } : {}),
    ...(sp && Object.keys(sp.style).length ? { style: sp.style } : {}),
  };
}

/** Classes of a Carousel slide frame: set by the Carousel preview for the items of its slot only. */
const SlideFrame = createContext<string | null>(null);

function Frame({ props, hidden, children }: { props: Props; hidden?: boolean; children: ReactNode }) {
  const dragRef = (props.puck as { dragRef?: ((e: Element | null) => void) | null } | undefined)?.dragRef ?? undefined;
  const slide = useContext(SlideFrame);
  const attrs = frameAttrs(props.style as NodeStyle | undefined);
  const className = [slide, attrs.className].filter(Boolean).join(' ') || undefined;
  return (
    <div ref={dragRef} {...attrs} className={className} hidden={hidden || undefined}>
      <SlideFrame.Provider value={null}>{children}</SlideFrame.Provider>
    </div>
  );
}

/** Region label as text: its label (string, or the en-US / first text of a localized label), else its name. */
function regionText(props: Props): string {
  const l = props.label;
  if (typeof l === 'string' && l.trim()) return l;
  if (isObj(l)) {
    const v = (l['en-US'] as string | undefined) ?? Object.values(l).find((x) => typeof x === 'string' && x);
    if (typeof v === 'string' && v) return v;
  }
  return typeof props.name === 'string' ? props.name : '';
}

/** A Region of a layout block: a labelled dashed drop area (base pages fill it). */
function RegionPreview({ props }: { props: Props }) {
  const allow = Array.isArray(props.allow) ? (props.allow as string[]) : [];
  const name = typeof props.name === 'string' ? props.name : '';
  return (
    <div data-region={name} className="rounded-xl border-2 border-dashed border-primary/40 p-6 text-center text-sm text-muted-foreground">
      <p className="font-medium text-foreground">
        {elementLabel('Region')}: {regionText(props)}
      </p>
      <p className="mt-1 text-xs">{t('blockBuilder.canvas.regionHint')}</p>
      {allow.length > 0 && <p className="mt-1 text-xs">{t('blockBuilder.canvas.slotAllow', { blocks: allow.join(', ') })}</p>}
    </div>
  );
}

const HATCH: CSSProperties = {
  backgroundImage: 'repeating-linear-gradient(135deg, var(--color-muted, #f4f4f5) 0 8px, transparent 8px 16px)',
};

/** Where each page's own blocks go: a hatched placeholder. */
function PageContentPreview() {
  return (
    <div data-page-content="" style={HATCH} className="rounded-xl border-2 border-dashed border-muted-foreground/40 p-10 text-center text-sm text-muted-foreground">
      <p className="font-medium text-foreground">{t('blockBuilder.canvas.pageContent')}</p>
      <p className="mt-1 text-xs">{t('blockBuilder.canvas.pageContentHint')}</p>
    </div>
  );
}

type OvSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';
type OvSide = 'left' | 'right' | 'top' | 'bottom';
// Literal class tables (Tailwind scans them; never interpolate). Sizes match `ui.Overlay`.
const OV_MODAL_SIZE: Record<OvSize, string> = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl', full: 'max-w-none h-full' };
const OV_X_SIZE: Record<OvSize, string> = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl', full: 'max-w-none' };
const OV_Y_SIZE: Record<OvSize, string> = { sm: 'h-1/3', md: 'h-1/2', lg: 'h-2/3', xl: 'h-5/6', full: 'h-full' };
const OV_SIDE: Record<OvSide, string> = { left: 'mr-auto ml-0', right: 'ml-auto mr-0', top: 'mb-auto mt-0', bottom: 'mt-auto mb-0' };
const OV_BACKDROP = {
  modal: 'flex min-h-[32rem] bg-black/40 p-6',
  x: 'flex min-h-[32rem] bg-black/40',
  y: 'flex h-[32rem] flex-col bg-black/40',
};
const pickOv = <T extends string>(table: Record<T, string>, v: unknown, d: T): T => (typeof v === 'string' && v in table ? (v as T) : d);

/**
 * The overlay frame of an overlay block, edited in place: a dimmed backdrop with the dialog box at its size, centred
 * (modal) or pinned to a side of the canvas (drawer). Never a real `<dialog>`. Padding goes to the content box, the
 * rest of the style to the box, like `ui.Overlay`.
 */
function OverlayPreview({ props }: { props: Props }) {
  const Slot = props.children as SlotComponent | undefined;
  const drawer = props.variant === 'drawer';
  const size = pickOv<OvSize>(OV_MODAL_SIZE, props.size, 'md');
  const side = pickOv<OvSide>(OV_SIDE, props.side, 'right');
  const axis = !drawer ? 'modal' : side === 'left' || side === 'right' ? 'x' : 'y';
  const { padding, hidden: _h, span: _s, ...rest } = (isObj(props.style) ? props.style : {}) as NodeStyle & Props;
  const fp = ui.styleProps(rest as NodeStyle);
  const cp = padding === undefined ? null : ui.styleProps({ padding } as NodeStyle, 'flex');
  const panel = [
    'relative overflow-auto border text-card-foreground shadow-lg',
    rest.background === undefined ? 'bg-card' : '',
    drawer ? 'w-full' : 'm-auto w-full rounded-xl',
    drawer ? OV_SIDE[side] : '',
    axis === 'modal' ? OV_MODAL_SIZE[size] : axis === 'x' ? OV_X_SIZE[size] : OV_Y_SIZE[size],
    fp.className,
  ].filter(Boolean).join(' ');
  const content = ['flex min-h-full flex-col gap-4', cp ? cp.className : 'p-6'].join(' ');
  const zone = Slot ? createElement(Slot, { className: content, style: cp?.style, minEmptyHeight: 96 } as never) : <div className={content} />;
  return (
    <div className={OV_BACKDROP[axis]}>
      <div data-overlay-panel="" data-variant={drawer ? 'drawer' : 'modal'} data-side={drawer ? side : undefined} className={panel} style={fp.style}>
        {zone}
        {props.showClose !== false && (
          <span data-overlay-close="" aria-hidden="true" title={t('blockBuilder.canvas.overlayClose')} className="absolute top-3 right-3 inline-flex size-8 items-center justify-center rounded-md text-xl leading-none text-muted-foreground">
            ×
          </span>
        )}
      </div>
    </div>
  );
}

// ---- component elements ----

/** A bound (or fixed) prop of a node as the canvas shows it: constant, manual field preview value or sample entry. */
function boundValue(c: CanvasModel, n: ComposedNode, prop: string): unknown {
  const s = n.bind?.[prop];
  if (!s) return n.props?.[prop];
  switch (s.from) {
    case 'const':
      return s.value;
    case 'field':
      return c.fieldValues[s.name];
    case 'entry':
      return (c.entry as Props | null)?.[s.path];
    case 'entryUrl':
      return c.binding?.urlPattern ? composedHelpers.entryUrl(c.binding.urlPattern, c.entry, (e, path) => (e as Props | null)?.[path]) : null;
  }
}
const boundText = (c: CanvasModel, n: ComposedNode, prop: string) => composedHelpers.text(boundValue(c, n, prop));
const boundHref = (c: CanvasModel, n: ComposedNode): string | null => (n.bind?.href ? composedHelpers.href(boundValue(c, n, 'href')) : null);

/** Whether item `id` or something inside it is selected. */
const useInSelection = (id: unknown) => useContext(CanvasSelection).path.includes(String(id));

/** The Puck slot of a container (a plain box outside Puck). */
function zone(props: Props, dz: { className?: string; style?: CSSProperties; minEmptyHeight?: number; collisionAxis?: 'x' | 'y' }): ReactNode {
  const Slot = props.children as SlotComponent | undefined;
  return Slot ? createElement(Slot, dz as never) : <div className={dz.className} style={dz.style} />;
}

/** Takes the props `ui.Accordion` gives its items (`name`, `open`, `editor`) off the slot it wraps. */
function ZoneHost({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

/** The validation message of an Accordion / Tabs without items (the issue at its `children`). */
export function itemsIssue(el: 'Accordion' | 'Tabs'): string {
  const spec = { id: 'blk_preview', name: 'BuilderPreview', label: { 'en-US': 'Preview' }, category: 'preview', version: 1, fields: {}, tree: { el, children: [] } };
  return validateComposedSpec(spec).find((i) => i.path.join('.') === 'tree.children')?.message ?? '';
}

/** Accordion / Tabs whose last item was removed: what to do, and the rule it breaks (spec Review focus 4). */
function EmptyItems({ el }: { el: 'Accordion' | 'Tabs' }) {
  const item = CHILD_ITEM[el]!;
  return (
    <div data-empty-items="" role="status" className="rounded-md border border-dashed border-warning px-3 py-2 text-center text-xs text-warning">
      <p>{t(`blockBuilder.canvas.empty${item}`)}</p>
      <p className="mt-1 font-mono">{itemsIssue(el)}</p>
    </div>
  );
}

/** Dimmed when hidden at the edited breakpoint or by the sample (show condition). */
function ComponentDim({ node, hidden, children }: { node: ComposedNode; hidden: boolean; children: ReactNode }) {
  const c = useContext(CanvasContext);
  const bp = useBreakpoint();
  return (
    <Dim reasons={[hidden && hiddenTitle(bp), !shown(c, node) && t('blockBuilder.canvas.hiddenBySample')]} fill={relativeHeight(node.style)}>
      {children}
    </Dim>
  );
}

function DropdownPreview({ props }: { props: Props }) {
  const c = useContext(CanvasContext);
  const node = useNode('Dropdown', props);
  const cs = canvasStyle(node.style, useBreakpoint());
  const p = node.props ?? {};
  const open = useInSelection(props.id);
  return (
    <ComponentDim node={node} hidden={cs.hidden}>
      <ui.Dropdown
        label={boundText(c, node, 'label')}
        href={boundHref(c, node)}
        openOn={p.openOn === 'click' ? 'click' : 'hover'}
        placement={p.placement as never}
        display={p.display as never}
        triggerVariant={p.triggerVariant as never}
        chevron={p.chevron !== false}
        locale={c.locale}
        style={cs.inner}
        editor={{ open }}
      >
        {zone(props, { className: 'flex flex-col gap-1', minEmptyHeight: 48 })}
      </ui.Dropdown>
    </ComponentDim>
  );
}

function TooltipPreview({ props }: { props: Props }) {
  const c = useContext(CanvasContext);
  const node = useNode('Tooltip', props);
  const cs = canvasStyle(node.style, useBreakpoint());
  const open = useInSelection(props.id);
  return (
    <ComponentDim node={node} hidden={cs.hidden}>
      <ui.Tooltip text={boundText(c, node, 'text')} side={(node.props?.side as never) ?? 'top'} style={cs.inner} editor={{ open }}>
        {zone(props, { minEmptyHeight: 40 })}
      </ui.Tooltip>
    </ComponentDim>
  );
}

function AccordionPreview({ props }: { props: Props }) {
  const node = useNode('Accordion', props);
  const cs = canvasStyle(node.style, useBreakpoint());
  const items = useContext(CanvasSelection).children(String(props.id));
  return (
    <ComponentDim node={node} hidden={cs.hidden}>
      <ui.Accordion single={node.props?.single === true} style={cs.inner} editor={{ open: true }}>
        <ZoneHost>{zone(props, { minEmptyHeight: 48 })}</ZoneHost>
      </ui.Accordion>
      {items.length === 0 && <EmptyItems el="Accordion" />}
    </ComponentDim>
  );
}

/** A click on a summary would close the `<details>` the canvas keeps open. */
const keepOpen = (e: MouseEvent) => {
  if ((e.target as Element).closest?.('summary')) e.preventDefault();
};

function AccordionItemPreview({ props }: { props: Props }) {
  const c = useContext(CanvasContext);
  const node = nodeOf('AccordionItem', props);
  return (
    <ComponentDim node={node} hidden={false}>
      <div onClickCapture={keepOpen}>
        <ui.AccordionItem title={boundText(c, node, 'title')} editor={{ open: true }}>
          {zone(props, { minEmptyHeight: 48 })}
        </ui.AccordionItem>
      </div>
    </ComponentDim>
  );
}

/** Id of the TabPanel the enclosing Tabs show (undefined outside Tabs). */
const ActiveTab = createContext<string | undefined>(undefined);

/** Index of the shown tab: the one selected or containing the selection, else the last one shown. */
function useActiveTab(items: readonly CanvasItem[], sel: CanvasSelectionModel): number {
  const inPath = items.findIndex((it) => sel.path.includes(String(it.props.id)));
  const [last, setLast] = useState(0);
  useEffect(() => {
    if (inPath >= 0 && inPath !== last) setLast(inPath);
  }, [inPath, last]);
  return inPath >= 0 ? inPath : Math.min(last, Math.max(0, items.length - 1));
}

function TabsPreview({ props }: { props: Props }) {
  const c = useContext(CanvasContext);
  const sel = useContext(CanvasSelection);
  const node = useNode('Tabs', props);
  const cs = canvasStyle(node.style, useBreakpoint());
  const items = sel.children(String(props.id)).filter((it) => it.type === 'TabPanel');
  const active = useActiveTab(items, sel);
  const slot = zone(props, { minEmptyHeight: 64 });
  const panels = items.map((it, i) => ({
    label: boundText(c, itemToNode(it as PuckItem), 'label') || elementLabel('TabPanel'),
    content: i === active ? slot : null,
  }));
  // A click on a tab selects its TabPanel (before Puck selects the Tabs).
  const onTab = (e: MouseEvent) => {
    const tab = (e.target as Element).closest?.('[role="tab"]');
    if (!tab?.parentElement) return;
    const i = [...tab.parentElement.children].indexOf(tab);
    const it = items[i];
    if (!it) return;
    e.stopPropagation();
    e.preventDefault();
    sel.select(String(it.props.id));
  };
  return (
    <ComponentDim node={node} hidden={cs.hidden}>
      <ActiveTab.Provider value={items[active] ? String(items[active]!.props.id) : undefined}>
        <div onClickCapture={onTab}>
          <ui.Tabs
            panels={panels}
            variant={node.props?.variant as never}
            align={node.props?.align as never}
            style={cs.inner}
            editor={{ activeIndex: active, onSelect: (i) => items[i] && sel.select(String(items[i]!.props.id)) }}
          />
          {items.length === 0 && slot}
        </div>
      </ActiveTab.Provider>
      {items.length === 0 && <EmptyItems el="Tabs" />}
    </ComponentDim>
  );
}

function TabPanelPreview({ props }: { props: Props }) {
  return <ComponentDim node={nodeOf('TabPanel', props)} hidden={false}>{zone(props, { minEmptyHeight: 64 })}</ComponentDim>;
}

const PER_VIEW = (x: unknown): x is number => typeof x === 'number' && x >= 1 && x <= 6;
/** Slides per view at each breakpoint (inherited upwards, 1 by default). */
export function perViewVars(perView: unknown, gap: unknown): CSSProperties {
  const r = resolveResponsive(perView as Responsive<number> | undefined);
  const base = PER_VIEW(r.base) ? r.base : 1;
  const md = PER_VIEW(r.md) ? r.md : base;
  const lg = PER_VIEW(r.lg) ? r.lg : md;
  const g = ui.CAROUSEL_GAP[(typeof gap === 'string' && gap in ui.CAROUSEL_GAP ? gap : '4') as keyof typeof ui.CAROUSEL_GAP];
  return { '--ocms-pv': String(base), '--ocms-pv-md': String(md), '--ocms-pv-lg': String(lg), '--ocms-gap': g } as CSSProperties;
}

/** A static Carousel: its slot is the track, each item a slide side by side (no snapping, controls or autoplay). */
function CarouselPreview({ props }: { props: Props }) {
  const node = useNode('Carousel', props);
  const cs = canvasStyle(node.style, useBreakpoint());
  const sp = ui.styleProps(cs.inner);
  return (
    <ComponentDim node={node} hidden={cs.hidden}>
      <section aria-roledescription="carousel" className={[ui.CAROUSEL, sp.className].filter(Boolean).join(' ')} style={sp.style}>
        <SlideFrame.Provider value={ui.CAROUSEL_SLIDE}>
          {zone(props, { className: ui.CAROUSEL_TRACK, style: perViewVars(node.props?.perView, node.props?.gap), minEmptyHeight: 96, collisionAxis: 'x' })}
        </SlideFrame.Provider>
      </section>
    </ComponentDim>
  );
}

const COMPONENT_PREVIEWS: Partial<Record<ComposedElement, (p: { props: Props }) => ReactElement>> = {
  Dropdown: DropdownPreview,
  Tooltip: TooltipPreview,
  Accordion: AccordionPreview,
  AccordionItem: AccordionItemPreview,
  Tabs: TabsPreview,
  TabPanel: TabPanelPreview,
  Carousel: CarouselPreview,
};

/** A TabPanel frame: hidden unless its Tabs show it. */
function TabPanelFrame({ props, children }: { props: Props; children: ReactNode }) {
  const active = useContext(ActiveTab);
  return (
    <Frame props={props} hidden={active !== undefined && active !== String(props.id)}>
      {children}
    </Frame>
  );
}

const usePuck = createUsePuck();

/** Provides the canvas selection (`CanvasSelection`) from Puck's state: put inside `<Puck>` (`overrides.puck`). */
export function CanvasSelectionProvider({ children }: { children?: ReactNode }) {
  const selectedId = usePuck((s) => (s.selectedItem ? String(s.selectedItem.props.id) : null));
  const data = usePuck((s) => s.appState.data);
  const getPuck = useGetPuck();
  const value = useMemo<CanvasSelectionModel>(() => {
    const index = indexPuck(data as unknown as BuilderPuckData);
    return {
      selectedId,
      path: pathOf(index, selectedId),
      children: (id) => {
        const kids = index.get(id)?.item.props.children;
        return Array.isArray(kids) ? (kids as CanvasItem[]) : [];
      },
      select: (id) => {
        const api = getPuck();
        const at = api.getSelectorForId(id);
        if (at) api.dispatch({ type: 'setUi', ui: { itemSelector: at } });
      },
    };
  }, [data, selectedId, getPuck]);
  return <CanvasSelection.Provider value={value}>{children}</CanvasSelection.Provider>;
}

/** Puck render of element `el`. */
export function elementRender(el: ComposedElement): (props: Props) => ReactElement {
  const Component = COMPONENT_PREVIEWS[el];
  if (Component) {
    if (el === 'TabPanel') return (props) => <TabPanelFrame props={props}><Component props={props} /></TabPanelFrame>;
    return (props) => <Frame props={props}><Component props={props} /></Frame>;
  }
  if (el === 'Overlay') {
    // The overlay is the root: its size is drawn by the preview, not by the item frame.
    return (props) => {
      const dragRef = (props.puck as { dragRef?: ((e: Element | null) => void) | null } | undefined)?.dragRef ?? undefined;
      return (
        <div ref={dragRef}>
          <OverlayPreview props={props} />
        </div>
      );
    };
  }
  const inner: (props: Props) => ReactElement =
    el === 'Slot'
      ? (props) => <SlotPreview props={props} />
      : el === 'Region'
        ? (props) => <RegionPreview props={props} />
        : el === 'PageContent'
          ? () => <PageContentPreview />
          : ['Box', 'Stack', 'Columns', 'Grid', 'Card'].includes(el)
        ? (props) => <ContainerPreview el={el as LayoutEl} props={props} />
        : (props) => <LeafPreview el={el} props={props} />;
  return (props) => <Frame props={props}>{inner(props)}</Frame>;
}

/** A further sample of a collection: the whole template drawn read-only. */
function Repeat({ entry }: { entry: unknown }) {
  const c = useContext(CanvasContext);
  const d = useMemo(() => definition(c, c.tree), [c]);
  if (d instanceof Error) return null;
  return (
    <div inert aria-hidden="true" className="pointer-events-none select-none">
      {renderWith(c, d, entry)}
    </div>
  );
}

/** Puck root render: the template once, or (collection) laid out like the block with the other samples after it. */
export function RootPreview({ children }: { children?: ReactNode }) {
  const c = useContext(CanvasContext);
  if (c.binding?.mode !== 'collection') return <>{children}</>;
  const l = c.binding.layout;
  const cls = l?.kind === 'list' ? ui.layoutClass.Stack({ direction: 'vertical', gap: '6' }) : ui.layoutClass.Grid({ columns: (l?.columns ?? 3) as 3, gap: '6' });
  return (
    <div className={cls}>
      <div>{children}</div>
      {c.repeats.map((e, i) => (
        <Repeat key={String((e as Props).documentId ?? i)} entry={e} />
      ))}
    </div>
  );
}
