// Pure, runtime-agnostic i18n helpers. Must not import from `node:*` (bundled for the browser).

export const SUPPORTED_LOCALES = [
  { code: 'en-US', name: 'English' },
  { code: 'vi-VN', name: 'Tiếng Việt' },
  { code: 'fr-FR', name: 'Français' },
  { code: 'id-ID', name: 'Bahasa Indonesia' },
] as const;

export type Locale = 'en-US' | 'vi-VN' | 'fr-FR' | 'id-ID';
export type LocalizedText = Partial<Record<Locale, string>> & { 'en-US': string };

export const DEFAULT_LOCALE: Locale = 'en-US';

export interface MessageTree {
  [key: string]: string | MessageTree;
}
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
/** Same shape as T, string leaves widened to `string`, every key optional. */
export type WidenPartial<T> = T extends string ? string : { [K in keyof T]?: WidenPartial<T[K]> };
export type MessageBundle = { 'en-US': MessageTree } & Partial<Record<Locale, MessageTree>>;

const CODES: readonly string[] = SUPPORTED_LOCALES.map((l) => l.code);

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && CODES.includes(v);
}

/** Resolves a language tag or an Accept-Language style header (or list) to a supported locale. */
export function matchLocale(input: string | readonly string[] | null | undefined): Locale {
  if (input == null) return DEFAULT_LOCALE;
  const parts = (Array.isArray(input) ? input : [input as string]).flatMap((s) => String(s).split(','));
  const ranked = parts
    .map((raw, index) => {
      const [tag, ...params] = raw.split(';');
      let q = 1;
      for (const p of params) {
        const m = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(p);
        if (m) q = Number(m[1]);
      }
      return { tag: tag.trim().toLowerCase(), q: Number.isFinite(q) ? q : 0, index };
    })
    .filter((x) => x.tag && x.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const { tag } of ranked) {
    const exact = SUPPORTED_LOCALES.find((l) => l.code.toLowerCase() === tag);
    if (exact) return exact.code;
    const lang = tag.split('-')[0];
    const byLang = SUPPORTED_LOCALES.find((l) => l.code.toLowerCase().split('-')[0] === lang);
    if (byLang) return byLang.code;
  }
  return DEFAULT_LOCALE;
}

/** Picks text for a locale: locale -> en-US -> fallback ?? ''. A plain string is `{ 'en-US': string }`. */
export function localizedText(v: string | LocalizedText | undefined, locale: Locale, fallback?: string): string {
  if (typeof v === 'string') return v;
  if (v) {
    const hit = v[locale];
    if (hit) return hit;
    if (v['en-US']) return v['en-US'];
  }
  return fallback ?? '';
}

/** Typing helper only: en-US is required, other locales may be partial. */
export function defineMessages<M extends MessageTree>(
  m: { 'en-US': M } & Partial<Record<Exclude<Locale, 'en-US'>, WidenPartial<M>>>,
): typeof m {
  return m;
}

function lookup(tree: MessageTree | undefined, key: string): string | undefined {
  let cur: string | MessageTree | undefined = tree;
  for (const part of key.split('.')) {
    if (cur === undefined || typeof cur === 'string') return undefined;
    cur = cur[part];
  }
  return typeof cur === 'string' ? cur : undefined;
}

export function createTranslator(
  messages: MessageBundle,
  locale: Locale,
): (key: string, vars?: Record<string, string | number>) => string {
  return (key, vars) => {
    const template = lookup(messages[locale], key) ?? lookup(messages['en-US'], key) ?? key;
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
      Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
    );
  };
}

export function formatDateTime(value: Date | string | number, locale: Locale, opts?: Intl.DateTimeFormatOptions): string {
  const d = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(locale, opts ?? { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

export function formatNumber(value: number, locale: Locale, opts?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, opts).format(value);
}
