// Pure conversion between a composed block's `tree` and the Puck data of the block builder canvas.
// Relative imports only (root vitest). Puck item props: the node's `props` flat, plus the reserved keys
// `id` (Puck), `bind`, `showIf`, `style` and, for containers, `children` (a Puck slot).
import type { BindSource, ComposedBlockSpec, ComposedElement, ComposedNode, NodeStyle } from '@opencloudcms/schema';

/** Elements that hold other elements (their Puck `children` slot). */
export const CONTAINER_ELEMENTS: readonly ComposedElement[] = ['Box', 'Stack', 'Columns', 'Grid', 'Card'];

/** Puck prop names that are not node props. */
export const RESERVED_ITEM_KEYS = ['id', 'bind', 'showIf', 'style', 'children'] as const;

type Props = Record<string, unknown>;
export interface PuckItem {
  type: string;
  props: Props & { id: string };
}
export interface BuilderPuckData {
  root: { props?: Props };
  content: PuckItem[];
  zones?: Record<string, PuckItem[]>;
}

const isObj = (v: unknown): v is Props => !!v && typeof v === 'object' && !Array.isArray(v);
export const isContainer = (el: string) => (CONTAINER_ELEMENTS as readonly string[]).includes(el);

/** Puck data for `spec.tree`: the tree root is the only top-level item. Ids are `<el>-<n>` in tree order. */
export function treeToPuck(spec: Pick<ComposedBlockSpec, 'tree'>): { data: BuilderPuckData } {
  let n = 0;
  const item = (node: ComposedNode): PuckItem => {
    const props: Props & { id: string } = { ...(node.props ?? {}), id: `${node.el}-${++n}` };
    if (node.bind) props.bind = structuredClone(node.bind);
    if (node.showIf) props.showIf = { ...node.showIf };
    if (isObj(node.style) && Object.keys(node.style).length) props.style = structuredClone(node.style);
    if (isContainer(node.el)) props.children = (node.children ?? []).map(item);
    return { type: node.el, props };
  };
  return { data: { root: { props: {} }, content: [item(spec.tree)], zones: {} } };
}

/** The spec node of one Puck item (children included). */
export function itemToNode(it: PuckItem): ComposedNode {
  const out: ComposedNode = { el: it.type as ComposedElement };
  const props: Props = {};
  for (const [k, v] of Object.entries(it.props ?? {})) {
    if ((RESERVED_ITEM_KEYS as readonly string[]).includes(k) || v === undefined) continue;
    props[k] = v;
  }
  if (Object.keys(props).length) out.props = props;
  const bind = it.props?.bind;
  if (isObj(bind)) {
    const clean = Object.fromEntries(Object.entries(bind).filter(([, s]) => isObj(s))) as Record<string, BindSource>;
    if (Object.keys(clean).length) out.bind = clean;
  }
  const showIf = it.props?.showIf;
  if (isObj(showIf)) out.showIf = showIf as unknown as ComposedNode['showIf'];
  const style = it.props?.style;
  if (isObj(style)) {
    const clean = Object.fromEntries(Object.entries(style).filter(([, v]) => v !== undefined));
    if (Object.keys(clean).length) out.style = clean as NodeStyle;
  }
  const kids = it.props?.children;
  if (Array.isArray(kids) && kids.length) out.children = (kids as PuckItem[]).map(itemToNode);
  return out;
}

/**
 * The spec `tree` of the canvas. One top-level item is the root; several are wrapped in a vertical `Stack`
 * (Puck lets users drop next to the root); none gives an empty `Box`.
 */
export function puckToTree(data: BuilderPuckData): ComposedNode {
  const items = (Array.isArray(data.content) ? data.content : []).filter((i) => isObj(i) && typeof i.type === 'string');
  if (items.length === 1) return itemToNode(items[0]!);
  if (items.length === 0) return { el: 'Box' };
  return { el: 'Stack', props: { direction: 'vertical' }, children: items.map(itemToNode) };
}
