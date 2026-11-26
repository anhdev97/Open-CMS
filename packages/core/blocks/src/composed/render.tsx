// Generic renderer of a composed block spec: walks `tree`, reads `bind` sources and renders the public `ui`
// primitives. Isomorphic (server components, editor canvas, CJS): no hooks, no browser or Node globals.
import { Fragment, type ReactNode } from 'react';
import type { BindSource, ComposedBlockSpec, ComposedNode, Responsive, Track } from '@opencloudcms/schema';
import type { ColorToken, SpacingToken } from '../types';
import { Badge, Button, DateText, Divider, Heading, Image, Price, Spacer, Text, validAction } from '../ui/content';
import { Box, Card, Columns, Grid, Stack } from '../ui/layout';
import { Overlay } from '../ui/overlay';
import { composedHelpers } from './helpers';

type Props = Record<string, unknown>;
type Entry = Record<string, unknown>;

const h = composedHelpers;
const isObj = (v: unknown): v is object => !!v && typeof v === 'object' && !Array.isArray(v);
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

interface Ctx {
  props: Props;
  entry: Entry | null;
  locale: string;
  urlPattern?: string;
  slots: WeakMap<ComposedNode, string>;
  /** Overlay blocks: the overlay name and the heading that names the dialog (gets `labelId`). */
  overlay?: { name: string; heading?: ComposedNode; labelId?: string };
  /** Entry field reader (warns once per missing path). */
  get: (entry: object | null | undefined, path: string) => unknown;
}

const entryValue = (ctx: Ctx, path: string): unknown => ctx.get(ctx.entry, path);

function source(ctx: Ctx, s: BindSource): unknown {
  switch (s.from) {
    case 'entry':
      return entryValue(ctx, s.path);
    case 'entryUrl':
      return ctx.urlPattern ? h.entryUrl(ctx.urlPattern, ctx.entry, ctx.get) : null;
    case 'field':
      return ctx.props[s.name];
    case 'const':
      return s.value;
  }
}

function visible(ctx: Ctx, n: ComposedNode): boolean {
  const c = n.showIf;
  if (!c) return true;
  const v = c.from === 'entry' ? entryValue(ctx, c.path ?? '') : ctx.props[c.name ?? ''];
  return h.present(v) === (c.is === 'present');
}

/** Bound value if `bind[k]` is set, else the fixed `props[k]`. */
const val = (ctx: Ctx, n: ComposedNode, k: string): unknown => (n.bind && has(n.bind, k) ? source(ctx, n.bind[k]) : n.props?.[k]);
const tok = <T,>(v: unknown) => v as T;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** First `Heading` of `n` (depth first) that is rendered: it and every ancestor pass their `showIf`. */
function firstVisibleHeading(ctx: Ctx, n: ComposedNode): ComposedNode | undefined {
  if (!visible(ctx, n)) return undefined;
  if (n.el === 'Heading') return n;
  for (const c of n.children ?? []) {
    const h = firstVisibleHeading(ctx, c);
    if (h) return h;
  }
  return undefined;
}

function renderNode(ctx: Ctx, n: ComposedNode, key?: number): ReactNode {
  if (!visible(ctx, n)) return null;
  const p = n.props ?? {};
  const st = n.style;
  const id = str(p.anchorId);
  const kids = (n.children ?? []).map((c, i) => renderNode(ctx, c, i));
  switch (n.el) {
    case 'Box':
      return <Box key={key} id={id} padding={tok<SpacingToken>(p.padding)} background={tok<ColorToken>(p.background)} style={st}>{kids}</Box>;
    case 'Stack':
      return (
        <Stack
          key={key}
          id={id}
          direction={isObj(p.direction) ? tok<Responsive<'vertical'>>(p.direction) : p.direction === 'horizontal' ? 'horizontal' : 'vertical'}
          gap={tok<SpacingToken>(p.gap)}
          align={tok<'start'>(p.align)}
          justify={tok<'start'>(p.justify)}
          wrap={typeof p.wrap === 'boolean' ? p.wrap : undefined}
          style={st}
        >
          {kids}
        </Stack>
      );
    case 'Columns':
      return (
        <Columns
          key={key}
          id={id}
          count={tok<2>(p.count)}
          gap={tok<SpacingToken>(p.gap)}
          tracks={tok<Responsive<Track[]>>(p.tracks)}
          alignY={tok<'start'>(p.alignY)}
          gapX={str(p.gapX)}
          gapY={str(p.gapY)}
          style={st}
        >
          {kids}
        </Columns>
      );
    case 'Grid':
      return <Grid key={key} id={id} columns={tok<3>(p.columns)} gap={tok<SpacingToken>(p.gap)} style={st}>{kids}</Grid>;
    case 'Card':
      return (
        <Card key={key} id={id} padding={tok<SpacingToken>(p.padding)} background={tok<ColorToken>(p.background)} bordered={p.bordered !== false} style={st}>
          {kids}
        </Card>
      );
    case 'Slot':
    case 'Region':
    case 'PageContent': {
      const name = ctx.slots.get(n);
      return <Fragment key={key}>{name ? (ctx.props[name] as ReactNode) ?? null : null}</Fragment>;
    }
    case 'Overlay': {
      const o = ctx.overlay!;
      return (
        <Overlay
          key={key}
          id={id}
          name={o.name}
          variant={tok<'modal'>(p.variant)}
          side={tok<'right'>(p.side)}
          size={tok<'md'>(p.size)}
          closeOnBackdrop={p.closeOnBackdrop !== false}
          showClose={p.showClose !== false}
          labelledBy={o.labelId}
          locale={ctx.locale}
          style={st}
        >
          {kids}
        </Overlay>
      );
    }
    case 'Heading':
      return <Heading key={key} id={ctx.overlay?.heading === n ? ctx.overlay.labelId : id} level={tok<2>(p.level ?? 2)} text={h.text(val(ctx, n, 'text'))} align={tok<'left'>(p.align)} style={st} />;
    case 'Text': {
      const html = val(ctx, n, 'html');
      return <Text key={key} id={id} text={h.text(val(ctx, n, 'text'))} html={html ?? undefined} size={tok<'base'>(p.size)} color={tok<ColorToken>(p.color)} style={st} />;
    }
    case 'Image': {
      // Explicit alt (bound or fixed) first, then the asset's own alt, then empty.
      const img = h.image(val(ctx, n, 'src'), val(ctx, n, 'alt'));
      if (!img) return null;
      return <Image key={key} id={id} src={img.src} alt={img.alt} ratio={tok<'auto'>(p.ratio)} rounded={p.rounded === true} fit={tok<'cover'>(p.fit)} aspect={tok<'auto'>(p.aspect)} style={st} />;
    }
    case 'Button':
      return (
        <Button
          key={key}
          id={id}
          label={h.text(val(ctx, n, 'label'))}
          href={h.href(val(ctx, n, 'href'))}
          variant={tok<'default'>(p.variant)}
          size={tok<'default'>(p.size)}
          style={st}
          action={validAction(p.action)}
        />
      );
    case 'Badge':
      return <Badge key={key} id={id} text={h.text(val(ctx, n, 'text'))} variant={tok<'default'>(p.variant)} style={st} />;
    case 'Price': {
      const m = h.money(val(ctx, n, 'value'));
      if (!m) return null;
      // `showCurrency: false` (set by the builder for `currencyMode: 'market'` money fields) → plain number.
      return <Price key={key} id={id} value={m.value} locale={ctx.locale} currency={p.showCurrency === false ? undefined : m.currency} style={st} />;
    }
    case 'Date':
      return (
        <DateText key={key} id={id} value={h.date(val(ctx, n, 'value'))} locale={ctx.locale} format={p.format === 'long' ? 'long' : 'short'} timeZone={str(p.timeZone)} style={st} />
      );
    case 'Divider':
      return <Divider key={key} id={id} style={st} />;
    case 'Spacer':
      return <Spacer key={key} id={id} size={tok<SpacingToken>(p.size ?? '8')} style={st} />;
    default:
      return null;
  }
}

/** `'list'` or `'grid-<2..6>'`: the stored value of the editor `layout` field. */
export function layoutValue(l: NonNullable<ComposedBlockSpec['binding']>['layout']): string {
  return l?.kind === 'list' ? 'list' : `grid-${l?.columns ?? 3}`;
}

/**
 * `render` of the BlockDefinition produced for `spec`. `slots` maps each `Slot`, `Region` and `PageContent` node to its
 * field name; `overlayName` is the default name of an overlay block (its `name` prop wins when valid).
 */
export function createComposedRender(spec: ComposedBlockSpec, slots: WeakMap<ComposedNode, string>, overlayName = ''): (props: Props) => ReactNode {
  const get = h.entryReader(spec.name);
  const binding = spec.binding;
  const block = { name: spec.name, label: spec.label };

  return (props) => {
    const locale = h.locale(props);
    const ctx = (entry: Entry | null): Ctx => ({ props, entry, locale, urlPattern: binding?.urlPattern, slots, overlay, get });
    let overlay: Ctx['overlay'];
    if (spec.tree.el === 'Overlay') {
      // Overlay blocks are never data-bound: visibility only reads fields.
      const name = h.overlayName(props.name, overlayName);
      const heading = firstVisibleHeading(ctx(null), spec.tree);
      overlay = { name, heading, labelId: heading ? str(heading.props?.anchorId) ?? `${name}-title` : undefined };
    }
    if (!binding) return renderNode(ctx(null), spec.tree);
    if (binding.mode === 'single') return h.single(props, block, (entry) => renderNode(ctx(entry), spec.tree));
    return h.collection(
      props,
      { ...block, layout: layoutValue(binding.layout), editorLayout: binding.options?.editorLayout === true, emptyText: binding.options?.emptyText },
      (entry) => renderNode(ctx(entry), spec.tree),
    );
  };
}
