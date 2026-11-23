// Generic renderer of a composed block spec: walks `tree`, reads `bind` sources and renders the public `ui`
// primitives. Isomorphic (server components, editor canvas, CJS): no hooks, no browser or Node globals.
import { Fragment, type ReactNode } from 'react';
import { localizedText, type BindSource, type ComposedBlockSpec, type ComposedNode, type Locale } from '@opencloudcms/schema';
import type { ColorToken, SpacingToken } from '../types';
import { Badge, Button, DateText, Divider, Heading, Image, Price, Spacer, Text } from '../ui/content';
import { Box, Card, Columns, Grid, Stack } from '../ui/layout';
import { entryUrl, isPresent, readDate, readEntryImage, readEntryMoney, readHref, readText } from './values';

type Props = Record<string, unknown>;
type Entry = Record<string, unknown>;

const DEFAULT_LOCALE = 'en-US';
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

const SELECT_ENTRY: Record<string, string> = {
  'en-US': 'Select an entry',
  'vi-VN': 'Chọn một mục nội dung',
  'fr-FR': 'Sélectionnez une entrée',
  'id-ID': 'Pilih satu entri',
};
const NO_ENTRIES: Record<string, string> = {
  'en-US': 'No entries match',
  'vi-VN': 'Không có mục nội dung phù hợp',
  'fr-FR': 'Aucune entrée ne correspond',
  'id-ID': 'Tidak ada entri yang cocok',
};

interface Ctx {
  props: Props;
  entry: Entry | null;
  locale: string;
  urlPattern?: string;
  slots: WeakMap<ComposedNode, string>;
  /** Reports an entry path missing from the entry (field deleted from the content type). */
  missing(path: string): void;
}

function entryValue(ctx: Ctx, path: string): unknown {
  if (!ctx.entry) return undefined;
  if (!has(ctx.entry, path)) {
    ctx.missing(path);
    return undefined;
  }
  return ctx.entry[path];
}

function source(ctx: Ctx, s: BindSource): unknown {
  switch (s.from) {
    case 'entry':
      return entryValue(ctx, s.path);
    case 'entryUrl':
      return ctx.urlPattern && ctx.entry ? entryUrl(ctx.urlPattern, (p) => entryValue(ctx, p)) : null;
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
  return isPresent(v) === (c.is === 'present');
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
      return <Heading key={key} level={tok<2>(p.level ?? 2)} text={readText(val(ctx, n, 'text'))} align={tok<'left'>(p.align)} />;
    case 'Text': {
      const html = val(ctx, n, 'html');
      return <Text key={key} text={readText(val(ctx, n, 'text'))} html={html ?? undefined} size={tok<'base'>(p.size)} color={tok<ColorToken>(p.color)} />;
    }
    case 'Image': {
      const img = readEntryImage(val(ctx, n, 'src'));
      if (!img) return null;
      // Explicit alt (bound or fixed) first, then the asset's own alt, then empty.
      const alt = n.bind?.alt || p.alt !== undefined ? readText(val(ctx, n, 'alt')) || img.alt : img.alt;
      return <Image key={key} src={img.src} alt={alt} ratio={tok<'auto'>(p.ratio)} rounded={p.rounded === true} />;
    }
    case 'Button':
      return <Button key={key} label={readText(val(ctx, n, 'label'))} href={readHref(val(ctx, n, 'href'))} variant={tok<'default'>(p.variant)} size={tok<'default'>(p.size)} />;
    case 'Badge':
      return <Badge key={key} text={readText(val(ctx, n, 'text'))} variant={tok<'default'>(p.variant)} />;
    case 'Price': {
      const m = readEntryMoney(val(ctx, n, 'value'));
      if (!m) return null;
      return <Price key={key} value={m.value} locale={ctx.locale} currency={m.currency} />;
    }
    case 'Date':
      return (
        <DateText key={key} value={readDate(val(ctx, n, 'value'))} locale={ctx.locale} format={p.format === 'long' ? 'long' : 'short'} timeZone={str(p.timeZone)} />
      );
    case 'Divider':
      return <Divider key={key} />;
    case 'Spacer':
      return <Spacer key={key} size={tok<SpacingToken>(p.size ?? '8')} />;
    default:
      return null;
  }
}

type Layout = { kind: 'grid'; columns: 2 | 3 | 4 | 5 | 6 } | { kind: 'list' };

/** `'list'` or `'grid-<2..6>'`: the stored value of the editor `layout` field. */
export function layoutValue(l: NonNullable<ComposedBlockSpec['binding']>['layout']): string {
  return l?.kind === 'list' ? 'list' : `grid-${l?.columns ?? 3}`;
}

function parseLayout(v: unknown): Layout | null {
  if (v === 'list') return { kind: 'list' };
  const m = typeof v === 'string' ? /^grid-([2-6])$/.exec(v) : null;
  return m ? { kind: 'grid', columns: Number(m[1]) as 2 } : null;
}

function Placeholder({ text }: { text: string }) {
  return (
    <div data-composed-placeholder="" className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

/** `render` of the BlockDefinition produced for `spec`. `slots` maps each `Slot` node to its field name. */
export function createComposedRender(spec: ComposedBlockSpec, slots: WeakMap<ComposedNode, string>): (props: Props) => ReactNode {
  const warned = new Set<string>();
  const missing = (path: string) => {
    if (warned.has(path)) return;
    warned.add(path);
    console.warn(`[opencloudcms] Block "${spec.name}": entry field "${path}" does not exist (removed from the content type?); rendering it empty.`);
  };
  const binding = spec.binding;

  return (props) => {
    const locale = typeof props._locale === 'string' && props._locale ? props._locale : DEFAULT_LOCALE;
    const editor = props._editor === true;
    const ctx = (entry: Entry | null): Ctx => ({ props, entry, locale, urlPattern: binding?.urlPattern, slots, missing });
    const label = localizedText(spec.label, locale as Locale, spec.name);

    if (!binding) return renderNode(ctx(null), spec.tree);

    if (binding.mode === 'single') {
      const entry = isObj(props.entry) ? props.entry : null;
      if (!entry) return editor ? <Placeholder text={`${label} · ${SELECT_ENTRY[locale] ?? SELECT_ENTRY[DEFAULT_LOCALE]}`} /> : null;
      return renderNode(ctx(entry), spec.tree);
    }

    const entries = Array.isArray(props.entries) ? props.entries.filter(isObj) : [];
    if (!entries.length) {
      const empty = binding.options?.emptyText ? localizedText(binding.options.emptyText, locale as Locale) : '';
      if (empty) return <Text text={empty} size="sm" color="muted" />;
      return editor ? <Placeholder text={`${label} · ${NO_ENTRIES[locale] ?? NO_ENTRIES[DEFAULT_LOCALE]}`} /> : null;
    }
    const layout =
      (binding.options?.editorLayout ? parseLayout(props.layout) : null) ?? parseLayout(layoutValue(binding.layout)) ?? { kind: 'grid', columns: 3 };
    const items = entries.map((e, i) => (
      <Fragment key={typeof e.documentId === 'string' ? e.documentId : i}>{renderNode(ctx(e), spec.tree)}</Fragment>
    ));
    return layout.kind === 'list' ? (
      <Stack direction="vertical" gap="6">{items}</Stack>
    ) : (
      <Grid columns={layout.columns} gap="6">{items}</Grid>
    );
  };
}
