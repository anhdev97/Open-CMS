// Canvas renders of the block builder. Every element is drawn by `defineComposedBlock` (the renderer of pages and
// the website) with the sample entry and `_locale`/`_editor` stamped, so the canvas looks like the page builder.
// Containers draw their Puck slot with the same layout classes and variables (`ui.layoutClass` / `ui.layoutStyle`).
// Components are `inline`: each render draws the item frame itself (Puck's drag ref), so a grid child's `span`
// and a percentage height (an Image filling its column) apply to the box the grid lays out.
import { createElement, useContext, useMemo, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import type { SlotComponent } from '@puckeditor/core';
import { composedHelpers, defineComposedBlock, ui, type ComposedBlockDefinition } from '@opencloudcms/core/blocks';
import { resolveResponsive, type ComposedBinding, type ComposedElement, type ComposedNode, type NodeStyle } from '@opencloudcms/schema';
import { t } from '../i18n';
import { CanvasContext, type CanvasModel } from './context';
import { elementLabel } from './element-config';
import { itemToNode, type PuckItem } from './tree-puck';

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

function Dim({ hidden, children }: { hidden: boolean; children: ReactNode }) {
  if (!hidden) return <>{children}</>;
  return (
    <div className="opacity-40" title={t('blockBuilder.canvas.hiddenBySample')}>
      {children}
    </div>
  );
}

function nodeOf(el: ComposedElement, props: Props): ComposedNode {
  const clean: Props = { id: '' };
  for (const [k, v] of Object.entries(props)) if (!PUCK_RENDER_KEYS.has(k)) clean[k] = v;
  return itemToNode({ type: el, props: clean } as PuckItem);
}

function LeafPreview({ el, props }: { el: ComposedElement; props: Props }) {
  const c = useContext(CanvasContext);
  const node = nodeOf(el, props);
  const { showIf, ...bare } = node;
  const d = definition(c, bare);
  let out: ReactNode = null;
  if (d instanceof Error) out = <Hint tone="warning">{t('blockBuilder.canvas.invalid', { element: elementLabel(el) })}</Hint>;
  else out = renderWith(c, d, c.entry);
  if (out === null || out === undefined || out === false) out = <Hint>{t('blockBuilder.canvas.empty', { element: elementLabel(el) })}</Hint>;
  return <Dim hidden={!shown(c, { ...bare, ...(showIf ? { showIf } : {}) })}>{out}</Dim>;
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
  const Slot = props.children as SlotComponent | undefined;
  const p = { ...props, direction: props.direction ?? 'vertical' };
  const cls = (ui.layoutClass[el] as (p: Props) => string)(p);
  const style = (ui.layoutStyle[el] as (p: Props) => CSSProperties | undefined)(p);
  const node = nodeOf(el, props);
  const zone = Slot ? createElement(Slot, { className: cls, style, minEmptyHeight: 64 } as never) : <div className={cls} style={style} />;
  return <Dim hidden={!shown(c, node)}>{zone}</Dim>;
}

/** Whether a style height is relative at some breakpoint (the frame must then fill its cell: `h-full`). */
function relativeHeight(style: NodeStyle | undefined): boolean {
  return Object.values(resolveResponsive(style?.height)).some((h) => typeof h === 'string' && h.endsWith('%'));
}

/** The item frame Puck drags: carries the element's column span and, for a relative height, `h-full`. */
export function frameAttrs(style: NodeStyle | undefined): { className?: string; style?: CSSProperties } {
  const span = style?.span !== undefined ? ui.styleProps({ span: style.span }) : null;
  const className = [span?.className, relativeHeight(style) ? 'h-full' : ''].filter(Boolean).join(' ');
  return {
    ...(className ? { className } : {}),
    ...(span && Object.keys(span.style).length ? { style: span.style } : {}),
  };
}

function Frame({ props, children }: { props: Props; children: ReactNode }) {
  const dragRef = (props.puck as { dragRef?: ((e: Element | null) => void) | null } | undefined)?.dragRef ?? undefined;
  return (
    <div ref={dragRef} {...frameAttrs(props.style as NodeStyle | undefined)}>
      {children}
    </div>
  );
}

/** Puck render of element `el`. */
export function elementRender(el: ComposedElement): (props: Props) => ReactElement {
  const inner: (props: Props) => ReactElement =
    el === 'Slot'
      ? (props) => <SlotPreview props={props} />
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
