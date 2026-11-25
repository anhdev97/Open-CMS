// Old token props of composed nodes → `style` / `tracks` (spec decision 2). Run by the builder on the first change
// of an item, so stored files change only when saved. Box/Card `background` is kept: the semantic token carries its
// paired foreground, and a style background replaces it when set.
import type { ComposedElement, NodeStyle, Responsive, Sides, Track } from '@opencloudcms/schema';

type Props = Record<string, unknown>;

const fr = (n: number): Track[] => Array.from({ length: n }, () => '1fr');

/** Tracks matching today's `COLS[count]` classes (`md:grid-cols-n`, and 4 = 2 on tablet then 4). */
export function tracksForCount(count: unknown): Responsive<Track[]> | undefined {
  const n = Number(count);
  if (n === 4) return { base: fr(1), md: fr(2), lg: fr(4) };
  if (n === 2 || n === 3) return { base: fr(1), md: fr(n) };
  return undefined;
}

export function migrateLegacyProps(
  el: ComposedElement,
  props: Props,
  style: NodeStyle | undefined,
): { props: Props; style: NodeStyle | undefined } {
  const out: Props = { ...props };
  let next = style;
  if ((el === 'Box' || el === 'Card') && 'padding' in out) {
    const p = out.padding;
    delete out.padding;
    if (typeof p === 'string' && style?.padding === undefined) {
      const sides: Sides = el === 'Box' ? { t: p, b: p } : { t: p, r: p, b: p, l: p };
      next = { ...(style ?? {}), padding: sides };
    }
  }
  if (el === 'Columns' && 'count' in out) {
    const tracks = out.tracks === undefined ? tracksForCount(out.count) : undefined;
    delete out.count;
    if (tracks) out.tracks = tracks;
  }
  return { props: out, style: next };
}

/** Whether `migrateLegacyProps` would change anything. */
export const hasLegacyProps = (el: ComposedElement, props: Props): boolean =>
  ((el === 'Box' || el === 'Card') && props.padding !== undefined) || (el === 'Columns' && props.count !== undefined);
