// Isomorphic content primitives. Rich text only through RichTextHtml (sanitized); numbers/dates via Intl.
import { createElement } from 'react';
import type { ColorToken, SpacingToken } from '../types';
import { RichTextHtml } from '../richtext-render';
import {
  ALIGN, BADGE_VARIANT, BUTTON_BASE, BUTTON_SIZE, BUTTON_VARIANT, H, HEADING, RATIO, TEXT_COLOR, TEXT_SIZE, cn,
  type BadgeVariant, type ButtonSize, type ButtonVariant,
} from './tokens';

export function Heading({ level, text, align }: { level: 1 | 2 | 3 | 4; text: string; align?: 'left' | 'center' | 'right' }) {
  const lv = (HEADING[level] ? level : 2) as 1 | 2 | 3 | 4;
  return createElement(`h${lv}`, { className: cn(HEADING[lv], ALIGN[align as 'left'] ?? ALIGN.left) }, text);
}

export function Text({ text, html, size, color }: { text?: string; html?: unknown; size?: 'sm' | 'base' | 'lg'; color?: ColorToken }) {
  const cls = cn(TEXT_SIZE[size as 'sm'] ?? TEXT_SIZE.base, color ? TEXT_COLOR[color] : undefined);
  if (html !== undefined && html !== null && html !== '') return <div className={cls}><RichTextHtml html={html} /></div>;
  return <p className={cls}>{text}</p>;
}

export function Image({ src, alt, ratio, rounded }: { src: string | null | undefined; alt?: string; ratio?: 'auto' | 'square' | 'video' | 'wide'; rounded?: boolean }) {
  if (!src) return null;
  return <img src={src} alt={alt ?? ''} loading="lazy" className={cn('w-full object-cover', RATIO[ratio as 'auto'] ?? RATIO.auto, rounded ? 'rounded-xl' : undefined)} />;
}

export function Button({ label, href, variant, size }: { label: string; href: string | null | undefined; variant?: ButtonVariant; size?: ButtonSize }) {
  const cls = cn(BUTTON_BASE, BUTTON_VARIANT[variant as ButtonVariant] ?? BUTTON_VARIANT.default, BUTTON_SIZE[size as ButtonSize] ?? BUTTON_SIZE.default);
  return href ? <a data-slot="button" href={href} className={cls}>{label}</a> : <span data-slot="button" className={cls}>{label}</span>;
}

export function Badge({ text, variant }: { text: string; variant?: BadgeVariant }) {
  return (
    <span
      data-slot="badge"
      className={cn('inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap', BADGE_VARIANT[variant as BadgeVariant] ?? BADGE_VARIANT.default)}
    >
      {text}
    </span>
  );
}

export function Price({ value, locale, currency }: { value: number | string | null | undefined; locale: string; currency?: string }) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  try {
    return <span>{new Intl.NumberFormat(locale, currency ? { style: 'currency', currency } : undefined).format(n)}</span>;
  } catch {
    return <span>{String(n)}</span>;
  }
}

export function DateText({ value, locale, format }: { value: string | number | Date | null | undefined; locale: string; format: 'short' | 'long' }) {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return <time dateTime={d.toISOString()}>{new Intl.DateTimeFormat(locale, { dateStyle: format === 'long' ? 'long' : 'short', timeZone: 'UTC' }).format(d)}</time>;
  } catch {
    return <time>{d.toISOString().slice(0, 10)}</time>;
  }
}

export function Divider() {
  return <hr className="my-6 border-border" />;
}

export function Spacer({ size }: { size: SpacingToken }) {
  return <div aria-hidden="true" className={H[size] ?? H['8']} />;
}
