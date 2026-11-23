// Generic renderer of a composed block spec: walks `tree`, reads `bind` sources and renders the public `ui`
// primitives. Isomorphic (server components, editor canvas, CJS): no hooks, no browser or Node globals.
import { Fragment, type ReactNode } from 'react';
import type { BindSource, ComposedBlockSpec, ComposedNode } from '@opencloudcms/schema';
import type { ColorToken, SpacingToken } from '../types';
import { Badge, Button, DateText, Divider, Heading, Image, Price, Spacer, Text } from '../ui/content';
import { Box, Card, Columns, Grid, Stack } from '../ui/layout';
import { composedHelpers } from './helpers';

type Props = Record<string, unknown>;
type Entry = Record<string, unknown>;

const h = composedHelpers;
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

interface Ctx {
  props: Props;
  entry: Entry | null;
  locale: string;
  urlPattern?: string;
  slots: WeakMap<ComposedNode, string>;
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

function renderNode(ctx: Ctx, n: ComposedNode, key?: number): ReactNode {
  if (!visible(ctx, n)) return null;
  const p = n.props ?? {};
  const kids = (n.children ?? []).map((c, i) => renderNode(ctx, c, i));
  switch (n.el) {
    case 'Box':
      return <Box key={key} padding={tok<SpacingToken>(p.padding)} background={tok<ColorToken>(p.background)}>{kids}</Box>;
    case 'Stack':
      return (
        <Stack key={key} direction={p.direction === 'horizontal' ? 'horizontal' : 'vertical'} gap={tok<SpacingToken>(p.gap)} align={tok<'start'>(p.align)}>
          {kids}
        </Stack>
      );
    case 'Columns':
      return <Columns key={key} count={tok<2>(p.count)} gap={tok<SpacingToken>(p.gap)}>{kids}</Columns>;
    case 'Grid':
      return <Grid key={key} columns={tok<3>(p.columns)} gap={tok<SpacingToken>(p.gap)}>{kids}</Grid>;
    case 'Card':
      return (
        <Card key={key} padding={tok<SpacingToken>(p.padding)} background={tok<ColorToken>(p.background)} bordered={p.bordered !== false}>
          {kids}
        </Card>
      );
    case 'Slot': {
      const name = ctx.slots.get(n);
      return <Fragment key={key}>{name ? (ctx.props[name] as ReactNode) ?? null : null}</Fragment>;
    }
    case 'Heading':
      return <Heading key={key} level={tok<2>(p.level ?? 2)} text={h.text(val(ctx, n, 'text'))} align={tok<'left'>(p.align)} />;
    case 'Text': {
      const html = val(ctx, n, 'html');
      return <Text key={key} text={h.text(val(ctx, n, 'text'))} html={html ?? undefined} size={tok<'base'>(p.size)} color={tok<ColorToken>(p.color)} />;
    }
    case 'Image': {
      // Explicit alt (bound or fixed) first, then the asset's own alt, then empty.
      const img = h.image(val(ctx, n, 'src'), val(ctx, n, 'alt'));
      if (!img) return null;
      return <Image key={key} src={img.src} alt={img.alt} ratio={tok<'auto'>(p.ratio)} rounded={p.rounded === true} />;
    }
    case 'Button':
      return <Button key={key} label={h.text(val(ctx, n, 'label'))} href={h.href(val(ctx, n, 'href'))} variant={tok<'default'>(p.variant)} size={tok<'default'>(p.size)} />;
    case 'Badge':
      return <Badge key={key} text={h.text(val(ctx, n, 'text'))} variant={tok<'default'>(p.variant)} />;
    case 'Price': {
      const m = h.money(val(ctx, n, 'value'));
      if (!m) return null;
      // `showCurrency: false` (set by the builder for `currencyMode: 'market'` money fields) → plain number.
      return <Price key={key} value={m.value} locale={ctx.locale} currency={p.showCurrency === false ? undefined : m.currency} />;
    }
    case 'Date':
      return (
        <DateText key={key} value={h.date(val(ctx, n, 'value'))} locale={ctx.locale} format={p.format === 'long' ? 'long' : 'short'} timeZone={str(p.timeZone)} />
      );
    case 'Divider':
      return <Divider key={key} />;
    case 'Spacer':
      return <Spacer key={key} size={tok<SpacingToken>(p.size ?? '8')} />;
    default:
      return null;
  }
}

/** `'list'` or `'grid-<2..6>'`: the stored value of the editor `layout` field. */
export function layoutValue(l: NonNullable<ComposedBlockSpec['binding']>['layout']): string {
  return l?.kind === 'list' ? 'list' : `grid-${l?.columns ?? 3}`;
}

/** `render` of the BlockDefinition produced for `spec`. `slots` maps each `Slot` node to its field name. */
export function createComposedRender(spec: ComposedBlockSpec, slots: WeakMap<ComposedNode, string>): (props: Props) => ReactNode {
  const get = h.entryReader(spec.name);
  const binding = spec.binding;
  const block = { name: spec.name, label: spec.label };

  return (props) => {
    const locale = h.locale(props);
    const ctx = (entry: Entry | null): Ctx => ({ props, entry, locale, urlPattern: binding?.urlPattern, slots, get });
    if (!binding) return renderNode(ctx(null), spec.tree);
    if (binding.mode === 'single') return h.single(props, block, (entry) => renderNode(ctx(entry), spec.tree));
    return h.collection(
      props,
      { ...block, layout: layoutValue(binding.layout), editorLayout: binding.options?.editorLayout === true, emptyText: binding.options?.emptyText },
      (entry) => renderNode(ctx(entry), spec.tree),
    );
  };
}
