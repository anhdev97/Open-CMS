// Generic renderer of a composed block spec: walks `tree`, reads `bind` sources and renders the public `ui`
// primitives. Isomorphic (server components, editor canvas, CJS): no hooks, no browser or Node globals.
import { Fragment, type ReactNode } from 'react';
import type { ButtonVariant } from '../ui/tokens';
import { localizedText, type BindSource, type CollectionListProps, type Locale, type ComposedBlockSpec, type ComposedNode, type Responsive, type Track } from '@opencloudcms/schema';
import type { ColorToken, SpacingToken } from '../types';
import { Badge, Button, DateText, Divider, Heading, Image, Price, Spacer, Text, validAction } from '../ui/content';
import { Box, Card, Columns, Grid, Stack } from '../ui/layout';
import { Overlay } from '../ui/overlay';
import { Icon, type IconSize } from '../ui/icon';
import { Tooltip } from '../ui/tooltip';
import { Accordion, AccordionItem } from '../ui/accordion';
import { Checkbox, Input, Radio, Select, Switch, Textarea, type ControlOption, type InputType } from '../ui/form';
import { safeHref } from '../ui/href';
import { Dropdown, type DropdownDisplay } from '../client/Dropdown';
import { Tabs } from '../client/Tabs';
import { Carousel } from '../client/Carousel';
import { Combobox } from '../client/Combobox';
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
  /** `entryUrl` of an entry where the node sits (block binding or the enclosing CollectionList). */
  link: (entry: Entry | null) => string | null;
  slots: WeakMap<ComposedNode, string>;
  /** Overlay blocks: the overlay name and the heading that names the dialog (gets `labelId`). */
  overlay?: { name: string; heading?: ComposedNode; labelId?: string };
  /** Entry field reader (warns once per missing path). */
  get: (entry: object | null | undefined, path: string) => unknown;
  /** Block label in the locale: the name of a clickable image without alt. */
  blockLabel: string;
  /** Inside a Tooltip: the target's first focusable node and the bubble id it is described by. */
  describe?: { node: ComposedNode; id: string };
  block: { name: string; label: ComposedBlockSpec['label'] };
}

/** `entryUrl` resolution (spec §4): `urlPattern` when set, else the `apiId` detail path (`_detailPaths`), else none. */
const linkFor = (ctx: Pick<Ctx, 'props' | 'get'>, urlPattern: string | undefined, apiId: string | undefined): Ctx['link'] =>
  urlPattern ? (entry) => h.entryUrl(urlPattern, entry, ctx.get) : apiId ? (entry) => h.detailUrl(ctx.props, apiId, entry) : () => null;

const entryValue = (ctx: Ctx, path: string): unknown => ctx.get(ctx.entry, path);

function source(ctx: Ctx, s: BindSource): unknown {
  switch (s.from) {
    case 'entry':
      return entryValue(ctx, s.path);
    case 'entryUrl':
      return ctx.link(ctx.entry);
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

/** Href of a clickable Image/Box/Card: only a bound `href` makes one (like `isClickable`); a fixed prop does not. */
const boundHref = (ctx: Ctx, n: ComposedNode): string | null => (n.bind && has(n.bind, 'href') ? h.href(source(ctx, n.bind.href)) : null);

/** Whether `n` itself renders as a link or button (it takes the focus a Tooltip describes). */
function focusableSelf(ctx: Ctx, n: ComposedNode): boolean {
  const p = n.props ?? {};
  switch (n.el) {
    case 'Button':
      return !!validAction(p.action) || !!safeHref(h.href(val(ctx, n, 'href')));
    case 'Image':
      return !!h.image(val(ctx, n, 'src'), val(ctx, n, 'alt')) && (!!validAction(p.action) || !!boundHref(ctx, n));
    case 'Box':
    case 'Card':
      return !!validAction(p.action) || !!boundHref(ctx, n);
    default:
      return false;
  }
}

/** First rendered node of `n` (depth first) that takes focus. */
function firstFocusable(ctx: Ctx, n: ComposedNode): ComposedNode | undefined {
  if (!visible(ctx, n)) return undefined;
  if (focusableSelf(ctx, n)) return n;
  for (const c of n.children ?? []) {
    const f = firstFocusable(ctx, c);
    if (f) return f;
  }
  return undefined;
}

const describedBy = (ctx: Ctx, n: ComposedNode): string | undefined => (ctx.describe?.node === n ? ctx.describe.id : undefined);
const options = (ctx: Ctx, v: unknown): ControlOption[] => h.options(v, ctx.locale);
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);

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
  const kids = () => (n.children ?? []).map((c, i) => renderNode(ctx, c, i));
  switch (n.el) {
    case 'Box':
      return (
        <Box
          key={key}
          id={id}
          padding={tok<SpacingToken>(p.padding)}
          background={tok<ColorToken>(p.background)}
          style={st}
          href={boundHref(ctx, n)}
          action={validAction(p.action)}
          ariaLabel={str(p.ariaLabel)}
          describedBy={describedBy(ctx, n)}
        >
          {kids()}
        </Box>
      );
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
          {kids()}
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
          {kids()}
        </Columns>
      );
    case 'Grid':
      return <Grid key={key} id={id} columns={tok<3>(p.columns)} gap={tok<SpacingToken>(p.gap)} style={st}>{kids()}</Grid>;
    case 'Card':
      return (
        <Card
          key={key}
          id={id}
          padding={tok<SpacingToken>(p.padding)}
          background={tok<ColorToken>(p.background)}
          bordered={p.bordered !== false}
          style={st}
          href={boundHref(ctx, n)}
          action={validAction(p.action)}
          ariaLabel={str(p.ariaLabel)}
          describedBy={describedBy(ctx, n)}
        >
          {kids()}
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
          {kids()}
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
      const href = boundHref(ctx, n);
      const action = validAction(p.action);
      // A clickable image is its link's name: a missing alt falls back to the block label.
      const alt = (href || action) && !img.alt.trim() ? ctx.blockLabel : img.alt;
      return (
        <Image
          key={key}
          id={id}
          src={img.src}
          alt={alt}
          ratio={tok<'auto'>(p.ratio)}
          rounded={p.rounded === true}
          fit={tok<'cover'>(p.fit)}
          aspect={tok<'auto'>(p.aspect)}
          style={st}
          href={href}
          action={action}
          describedBy={describedBy(ctx, n)}
        />
      );
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
          icon={str(p.icon)}
          iconPosition={p.iconPosition === 'end' ? 'end' : undefined}
          iconOnly={p.iconOnly === true}
          describedBy={describedBy(ctx, n)}
        />
      );
    case 'Icon':
      return <Icon key={key} id={id} name={str(p.name) ?? ''} size={tok<IconSize>(p.size)} label={h.text(val(ctx, n, 'label'))} style={st} />;
    case 'Tooltip': {
      const child = n.children?.[0];
      // No child, or one hidden by its showIf: no tooltip at all (not an empty focusable wrapper).
      if (!child || !visible(ctx, child)) return null;
      const target = firstFocusable(ctx, child);
      return (
        <Tooltip key={key} id={id} text={h.text(val(ctx, n, 'text'))} side={tok<'top'>(p.side)} focusWrapper={!target} style={st}>
          {(tipId: string) => renderNode(target ? { ...ctx, describe: { node: target, id: tipId } } : ctx, child)}
        </Tooltip>
      );
    }
    case 'Accordion':
      return (
        <Accordion key={key} id={id} single={p.single === true} defaultOpen={p.defaultOpen === 'first' ? 'first' : 'none'} style={st}>
          {kids()}
        </Accordion>
      );
    case 'AccordionItem':
      return <AccordionItem key={key} id={id} title={h.text(val(ctx, n, 'title'))}>{kids()}</AccordionItem>;
    case 'Dropdown':
      return (
        <Dropdown
          key={key}
          id={id}
          label={h.text(val(ctx, n, 'label'))}
          href={boundHref(ctx, n)}
          openOn={p.openOn === 'click' ? 'click' : 'hover'}
          placement={tok<'bottom-start'>(p.placement)}
          display={tok<Responsive<DropdownDisplay>>(p.display)}
          triggerVariant={tok<ButtonVariant>(p.triggerVariant)}
          chevron={p.chevron !== false}
          locale={ctx.locale}
          style={st}
        >
          {kids()}
        </Dropdown>
      );
    case 'Tabs': {
      const panels = (n.children ?? [])
        .filter((c) => c.el === 'TabPanel' && visible(ctx, c))
        .map((c) => ({
          label: h.text(val(ctx, c, 'label')),
          id: str(c.props?.anchorId),
          content: (c.children ?? []).map((g, i) => renderNode(ctx, g, i)),
        }));
      return <Tabs key={key} id={id} panels={panels} variant={tok<'underline'>(p.variant)} align={tok<'start'>(p.align)} style={st} />;
    }
    case 'Carousel':
      return (
        <Carousel
          key={key}
          id={id}
          perView={tok<Responsive<number>>(p.perView)}
          gap={tok<SpacingToken>(p.gap)}
          arrows={p.arrows !== false}
          dots={p.dots !== false}
          loop={p.loop === true}
          autoplay={typeof p.autoplay === 'number' ? p.autoplay : 'off'}
          label={ctx.blockLabel}
          locale={ctx.locale}
          style={st}
        >
          {kids()}
        </Carousel>
      );
    case 'Combobox':
      return (
        <Combobox
          key={key}
          id={id}
          name={str(p.name) ?? ''}
          options={options(ctx, p.options)}
          defaultValue={str(p.defaultValue)}
          label={h.text(val(ctx, n, 'label'))}
          placeholder={h.text(val(ctx, n, 'placeholder'))}
          help={h.text(val(ctx, n, 'help'))}
          required={bool(p.required)}
          disabled={bool(p.disabled)}
          locale={ctx.locale}
          style={st}
        />
      );
    case 'Input':
      return (
        <Input
          key={key}
          id={id}
          name={str(p.name) ?? ''}
          type={tok<InputType>(p.type)}
          label={h.text(val(ctx, n, 'label'))}
          placeholder={h.text(val(ctx, n, 'placeholder'))}
          help={h.text(val(ctx, n, 'help'))}
          required={bool(p.required)}
          disabled={bool(p.disabled)}
          autocomplete={str(p.autocomplete)}
          style={st}
        />
      );
    case 'Textarea':
      return (
        <Textarea
          key={key}
          id={id}
          name={str(p.name) ?? ''}
          rows={typeof p.rows === 'number' ? p.rows : undefined}
          label={h.text(val(ctx, n, 'label'))}
          placeholder={h.text(val(ctx, n, 'placeholder'))}
          help={h.text(val(ctx, n, 'help'))}
          required={bool(p.required)}
          disabled={bool(p.disabled)}
          style={st}
        />
      );
    case 'Select':
      return (
        <Select
          key={key}
          id={id}
          name={str(p.name) ?? ''}
          options={options(ctx, p.options)}
          defaultValue={str(p.defaultValue)}
          label={h.text(val(ctx, n, 'label'))}
          placeholder={h.text(val(ctx, n, 'placeholder'))}
          help={h.text(val(ctx, n, 'help'))}
          required={bool(p.required)}
          disabled={bool(p.disabled)}
          style={st}
        />
      );
    case 'Radio':
      return (
        <Radio
          key={key}
          id={id}
          name={str(p.name) ?? ''}
          options={options(ctx, p.options)}
          defaultValue={str(p.defaultValue)}
          orientation={p.orientation === 'horizontal' ? 'horizontal' : 'vertical'}
          label={h.text(val(ctx, n, 'label'))}
          help={h.text(val(ctx, n, 'help'))}
          required={bool(p.required)}
          disabled={bool(p.disabled)}
          style={st}
        />
      );
    case 'Checkbox':
      return (
        <Checkbox
          key={key}
          id={id}
          name={str(p.name) ?? ''}
          value={str(p.value)}
          defaultChecked={bool(p.defaultChecked)}
          label={h.text(val(ctx, n, 'label'))}
          help={h.text(val(ctx, n, 'help'))}
          required={bool(p.required)}
          disabled={bool(p.disabled)}
          style={st}
        />
      );
    case 'Switch':
      return (
        <Switch
          key={key}
          id={id}
          name={str(p.name) ?? ''}
          defaultChecked={bool(p.defaultChecked)}
          label={h.text(val(ctx, n, 'label'))}
          help={h.text(val(ctx, n, 'help'))}
          disabled={bool(p.disabled)}
          style={st}
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
    case 'CollectionList': {
      const lp = p as unknown as CollectionListProps;
      // Inside the item template `entry` is the item and `entryUrl` uses only the list's urlPattern, else the list
      // type's detail path (decision 9).
      const link = linkFor(ctx, lp.urlPattern, lp.apiId);
      return (
        <Fragment key={key}>
          {h.list(
            ctx.props,
            {
              name: ctx.block.name,
              label: ctx.block.label,
              key: lp.key,
              layout: layoutValue(lp.layout),
              editorLayout: lp.editor?.layout === true,
              emptyText: lp.emptyText,
              id,
              style: st,
            },
            (entry) => <>{(n.children ?? []).map((c, i) => renderNode({ ...ctx, entry, link }, c, i))}</>,
          )}
        </Fragment>
      );
    }
    case 'Divider':
      return <Divider key={key} id={id} style={st} />;
    case 'Spacer':
      return <Spacer key={key} id={id} size={tok<SpacingToken>(p.size ?? '8')} style={st} />;
    default:
      return null;
  }
}

/** `'list'`, `'grid-<2..6>'` or `'carousel-<1..6>'`: the stored value of the editor `layout` field (default grid 3). */
export function layoutValue(l: NonNullable<ComposedBlockSpec['binding']>['layout']): string {
  if (l?.kind === 'list') return 'list';
  if (l?.kind === 'carousel') return `carousel-${l.columns ?? 3}`;
  return `grid-${l?.columns ?? 3}`;
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
    const blockLabel = localizedText(spec.label, locale as Locale, spec.name) || spec.name;
    const link = linkFor({ props, get }, binding?.urlPattern, binding?.apiId);
    const ctx = (entry: Entry | null): Ctx => ({ props, entry, locale, link, slots, overlay, get, blockLabel, block });
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
