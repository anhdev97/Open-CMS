// Isomorphic content primitives. Rich text only through RichTextHtml (sanitized); numbers/dates via Intl.
import { createElement, isValidElement } from 'react';
import type { NodeStyle, Responsive } from '@opencloudcms/schema';
import { safeHref } from './href';
import type { ColorToken, SpacingToken } from '../types';
import { RichTextHtml } from '../richtext-render';
import {
  ALIGN, BADGE_VARIANT, BUTTON_BASE, BUTTON_SIZE, BUTTON_VARIANT, BUTTON_VARIANT_STYLED_BG, H, HEADING, IMAGE_ASPECT, OBJECT_FIT, RATIO, TEXT_COLOR, TEXT_SIZE, cn,
  type BadgeVariant, type ButtonSize, type ButtonVariant, type ImageAspect,
} from './tokens';
import { bpClasses, setsBackground, styleAttr, styleProps } from './style';

type Styled = { style?: NodeStyle };

export function Heading({ level, text, align, style }: Styled & { level: 1 | 2 | 3 | 4; text: string; align?: 'left' | 'center' | 'right' }) {
  const lv = (HEADING[level] ? level : 2) as 1 | 2 | 3 | 4;
  const sp = styleProps(style, 'block');
  return createElement(`h${lv}`, { className: cn(HEADING[lv], ALIGN[align as 'left'] ?? ALIGN.left, sp.className), style: styleAttr(sp) }, text);
}

export function Text({ text, html, size, color, style }: Styled & { text?: string; html?: unknown; size?: 'sm' | 'base' | 'lg'; color?: ColorToken }) {
  const sp = styleProps(style, 'block');
  const cls = cn(TEXT_SIZE[size as 'sm'] ?? TEXT_SIZE.base, color ? TEXT_COLOR[color] : undefined, sp.className);
  const st = styleAttr(sp);
  // A rich text prop already transformed by Puck's `Render` (richTextFieldTransforms) arrives as an element.
  if (isValidElement(html)) return <div className={cls} style={st}>{html}</div>;
  if (html !== undefined && html !== null && html !== '') return <div className={cls} style={st}><RichTextHtml html={html} /></div>;
  return <p className={cls} style={st}>{text}</p>;
}

type ImageProps = Styled & {
  src: string | null | undefined;
  alt?: string;
  ratio?: 'auto' | 'square' | 'video' | 'wide';
  rounded?: boolean;
  fit?: 'cover' | 'contain';
  /** Responsive aspect ratio; takes over from `ratio` when it yields a class. */
  aspect?: Responsive<ImageAspect>;
};

/** A style `height` (e.g. `100%`, to fill a column) replaces the ratio's `h-auto`; `fit` sets object-fit. */
export function Image({ src, alt, ratio, rounded, fit, aspect, style }: ImageProps) {
  if (!src) return null;
  const sp = styleProps(style, 'block');
  const asp = aspect === undefined ? [] : bpClasses<ImageAspect>(aspect, IMAGE_ASPECT);
  const cls = cn('w-full', OBJECT_FIT[fit as 'cover'] ?? OBJECT_FIT.cover, asp.length ? asp : RATIO[ratio as 'auto'] ?? RATIO.auto, rounded ? 'rounded-xl' : undefined, sp.className);
  return <img src={src} alt={alt ?? ''} loading="lazy" className={cls} style={styleAttr(sp)} />;
}

export function Button({ label, href, variant, size, style }: Styled & { label: string; href: string | null | undefined; variant?: ButtonVariant; size?: ButtonSize }) {
  const sp = styleProps(style, 'inline-flex');
  const variants = setsBackground(sp) ? BUTTON_VARIANT_STYLED_BG : BUTTON_VARIANT;
  const cls = cn(BUTTON_BASE, variants[variant as ButtonVariant] ?? variants.default, BUTTON_SIZE[size as ButtonSize] ?? BUTTON_SIZE.default, sp.className);
  const st = styleAttr(sp);
  const safe = safeHref(href);
  return safe ? <a data-slot="button" href={safe} className={cls} style={st}>{label}</a> : <span data-slot="button" className={cls} style={st}>{label}</span>;
}

export function Badge({ text, variant, style }: Styled & { text: string; variant?: BadgeVariant }) {
  const sp = styleProps(style, 'inline-flex');
  return (
    <span
      data-slot="badge"
      className={cn('inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap', BADGE_VARIANT[variant as BadgeVariant] ?? BADGE_VARIANT.default, sp.className)}
      style={styleAttr(sp)}
    >
      {text}
    </span>
  );
}

/** className/style of an element with no token classes: absent attributes when there is no style. */
const inlineAttrs = (style: NodeStyle | undefined) => {
  const sp = styleProps(style, 'inline');
  return { className: sp.className || undefined, style: styleAttr(sp) };
};

export function Price({ value, locale, currency, style }: Styled & { value: number | string | null | undefined; locale: string; currency?: string }) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const a = inlineAttrs(style);
  try {
    return <span {...a}>{new Intl.NumberFormat(locale, currency ? { style: 'currency', currency } : undefined).format(n)}</span>;
  } catch {
    return <span {...a}>{String(n)}</span>;
  }
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `timeZone` (IANA, default `'UTC'`) applies to datetimes; a date-only `YYYY-MM-DD` value is a calendar day and is
 * always formatted in UTC so it never shifts by a day.
 */
export function DateText({
  value, locale, format, timeZone, style,
}: Styled & { value: string | number | Date | null | undefined; locale: string; format: 'short' | 'long'; timeZone?: string }) {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const zone = typeof value === 'string' && DATE_ONLY_RE.test(value) ? 'UTC' : timeZone || 'UTC';
  const a = inlineAttrs(style);
  try {
    return <time dateTime={d.toISOString()} {...a}>{new Intl.DateTimeFormat(locale, { dateStyle: format === 'long' ? 'long' : 'short', timeZone: zone }).format(d)}</time>;
  } catch {
    return <time {...a}>{d.toISOString().slice(0, 10)}</time>;
  }
}

export function Divider({ style }: Styled = {}) {
  const sp = styleProps(style, 'block');
  return <hr className={cn('my-6 border-border', sp.className)} style={styleAttr(sp)} />;
}

export function Spacer({ size, style }: Styled & { size: SpacingToken }) {
  const sp = styleProps(style, 'block');
  return <div aria-hidden="true" className={cn(H[size] ?? H['8'], sp.className)} style={styleAttr(sp)} />;
}
