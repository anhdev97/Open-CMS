// Slug fields and entry detail paths. Pure and isomorphic: must not import from `node:*`.
import { validatePagePath } from './pages';
import { foldSearch } from './search';
import type { ContentTypeDefinition, FieldDefinition, FieldKind } from './types';

/** Format of a slug value (a `documentId` matches it too). */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Default `maxLength` of a slug. */
export const SLUG_MAX_LENGTH = 75;

/** Letters `foldSearch` leaves alone that have a usual Latin spelling. */
const LETTERS: Record<string, string> = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', ł: 'l', þ: 'th', ð: 'd', ı: 'i' };

/** Cuts a slug to at most `max` characters, at a dash when the cut falls inside a word. */
function cutSlug(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 0) return '';
  if (s[max] === '-') return s.slice(0, max);
  const head = s.slice(0, max);
  const dash = head.lastIndexOf('-');
  return (dash > 0 ? head.slice(0, dash) : head).replace(/-+$/, '');
}

/**
 * SEO slug of `text`: accents removed (`foldSearch`), `&` → `va` (Vietnamese) or `and`, emoji, symbols and other
 * characters become separators, lowercase, single dashes, cut at a dash to `maxLength`. `'---'` → `''`.
 */
export function slugify(text: string, locale: string, maxLength = SLUG_MAX_LENGTH): string {
  const and = /^vi(?:-|$)/i.test(String(locale ?? '')) ? 'va' : 'and';
  const s = foldSearch(String(text ?? ''))
    .replace(/[ßæœøłþðı]/g, (c) => LETTERS[c])
    .replace(/&/g, ` ${and} `)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cutSlug(s, maxLength);
}

/** The pattern of a slug field: `options.pattern`, or the legacy `from: 'x'` read as `{x}`; null for neither. */
export function slugPattern(field: Pick<FieldDefinition, 'kind' | 'options'>): string | null {
  if (field?.kind !== 'slug') return null;
  const o = (field.options ?? {}) as { pattern?: unknown; from?: unknown };
  if (typeof o.pattern === 'string' && o.pattern) return o.pattern;
  if (typeof o.from === 'string' && o.from) return `{${o.from}}`;
  return null;
}

export type SlugPatternPart =
  | { kind: 'text'; value: string }
  | { kind: 'field'; name: string }
  | { kind: 'id' }
  | { kind: 'id6' };

/** Field kinds a slug pattern may use as `{field}` (taxonomy: the term name). */
export const SLUG_PATTERN_FIELD_KINDS: readonly FieldKind[] = ['text', 'longText', 'number', 'email', 'taxonomy'];

const PLACEHOLDER_RE = /^[A-Za-z][A-Za-z0-9]*$/;
const LITERAL_RE = /^[a-z0-9-]+$/;

type Token = { kind: 'text'; value: string } | { kind: 'placeholder'; name: string };

/** Splits a pattern into text and `{placeholder}` tokens, with its syntax problems. */
function tokenize(src: string): { tokens: Token[]; issues: string[] } {
  const tokens: Token[] = [];
  const issues: string[] = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    const textEnd = open === -1 ? src.length : open;
    if (textEnd > i) {
      const value = src.slice(i, textEnd);
      if (value.includes('}')) issues.push(`unexpected "}" in pattern "${src}"`);
      else if (!LITERAL_RE.test(value)) issues.push(`pattern text "${value}" must use lowercase letters, digits and dashes`);
      tokens.push({ kind: 'text', value });
    }
    if (open === -1) break;
    const close = src.indexOf('}', open);
    if (close === -1) {
      issues.push(`unclosed "{" in pattern "${src}"`);
      break;
    }
    tokens.push({ kind: 'placeholder', name: src.slice(open + 1, close) });
    i = close + 1;
  }
  return { tokens, issues };
}

/**
 * Splits a slug pattern into parts and reports its problems (messages without a location prefix): `{field}` must
 * name a text, longText, number, email or taxonomy field of `def`; `{id}` and `{id6}` are the documentId and its first
 * hex characters; text between placeholders uses lowercase letters, digits and dashes; at least one placeholder.
 */
export function parseSlugPattern(pattern: string, def: Pick<ContentTypeDefinition, 'fields'>): { parts: SlugPatternPart[]; issues: string[] } {
  const { tokens, issues } = tokenize(typeof pattern === 'string' ? pattern : '');
  const parts: SlugPatternPart[] = [];
  for (const t of tokens) {
    if (t.kind === 'text') parts.push(t);
    else if (t.name === 'id' || t.name === 'id6') parts.push({ kind: t.name });
    else {
      const field = PLACEHOLDER_RE.test(t.name) ? (def?.fields ?? []).find((x) => x.name === t.name) : undefined;
      if (!field) issues.push(`unknown placeholder "{${t.name}}"`);
      else if (!SLUG_PATTERN_FIELD_KINDS.includes(field.kind)) {
        issues.push(`placeholder "{${t.name}}": ${field.kind} fields cannot be used in a slug pattern`);
      } else parts.push({ kind: 'field', name: t.name });
    }
  }
  if (!issues.length && !parts.some((p) => p.kind !== 'text')) issues.push('pattern needs at least one placeholder such as {name} or {id}');
  return { parts, issues };
}

/** Text of a pattern field value: strings, numbers, a taxonomy term (`{ name }`) or the first of a list. */
function valueText(v: unknown): string {
  if (Array.isArray(v)) return v.length ? valueText(v[0]) : '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (v && typeof v === 'object' && typeof (v as { name?: unknown }).name === 'string') return (v as { name: string }).name;
  return '';
}

/**
 * Slug of an entry from `pattern`: each part is slugified, empty parts are skipped, the rest joined with `-`. When the
 * result is longer than `maxLength`, the field parts are cut (at dashes) so `{id}` / `{id6}` and the pattern text are
 * kept. `idLength`: hex characters of `{id6}` (6; 8 on a collision). `''` when every part is empty.
 */
export function renderSlugPattern(
  pattern: string, values: Record<string, unknown>, documentId: string, locale: string, maxLength = SLUG_MAX_LENGTH, idLength = 6,
): string {
  const parts: SlugPatternPart[] = tokenize(typeof pattern === 'string' ? pattern : '').tokens.map((t) => (
    t.kind === 'text' ? t : t.name === 'id' || t.name === 'id6' ? { kind: t.name } : { kind: 'field', name: t.name }
  ));
  const hex = String(documentId ?? '').toLowerCase().replace(/[^0-9a-f]/g, '');
  const rendered = parts.map((p) => {
    if (p.kind === 'id') return { field: false, text: slugify(documentId, locale, Infinity) };
    if (p.kind === 'id6') return { field: false, text: hex.slice(0, idLength) };
    if (p.kind === 'text') return { field: false, text: slugify(p.value, locale, Infinity) };
    return { field: true, text: slugify(valueText(values?.[p.name]), locale, Infinity) };
  }).filter((p) => p.text);
  const join = () => rendered.filter((p) => p.text).map((p) => p.text).join('-');
  let out = join();
  if (out.length > maxLength) {
    const fixed = rendered.filter((p) => !p.field);
    let budget = maxLength - fixed.reduce((n, p) => n + p.text.length + 1, 0);
    for (const p of rendered) {
      if (!p.field) continue;
      p.text = cutSlug(p.text, Math.max(budget, 0));
      budget -= p.text ? p.text.length + 1 : 0;
    }
    out = join();
  }
  return cutSlug(out, maxLength);
}

export type DetailParam = 'slug' | 'id';

/**
 * `'/products/{slug}'` → `{ prefix: '/products', param: 'slug' }`. Valid: starts with `/`, one or more static segments
 * that follow the page path rules (lowercase, not reserved), then exactly one `{slug}` or `{id}` as the last segment.
 */
export function parseDetailPath(path: string): { prefix: string; param: DetailParam } | null {
  if (typeof path !== 'string' || !path.startsWith('/')) return null;
  const m = /^(\/.+)\/\{(slug|id)\}$/.exec(path);
  if (!m) return null;
  const prefix = m[1];
  if (prefix.includes('{') || prefix.includes('}') || !validatePagePath(prefix).ok) return null;
  return { prefix, param: m[2] as DetailParam };
}

/** True when two detail paths match the same URLs (same static prefix). Invalid paths never overlap. */
export function detailPatternsOverlap(a: string, b: string): boolean {
  const pa = parseDetailPath(a);
  const pb = parseDetailPath(b);
  return !!pa && !!pb && pa.prefix === pb.prefix;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** True when `def` has a usable detail page (non-private, valid path, `{slug}` with an existing slug field). */
function detailEnabled(def: ContentTypeDefinition): { prefix: string; param: DetailParam } | null {
  if (def.private || !def.detailPage || typeof def.detailPage !== 'object') return null;
  const parsed = parseDetailPath(def.detailPage.path);
  if (!parsed) return null;
  if (parsed.param === 'slug') {
    const field = def.fields.find((x) => x.name === def.detailPage!.slugField);
    if (!field || field.kind !== 'slug') return null;
  }
  return parsed;
}

/**
 * The content type whose detail path matches `path` (no query string), with the slug or id value. Only types with
 * a usable detail page match; slug values must match `SLUG_RE` and id values a lowercase UUID.
 */
export function matchDetailPath(defs: readonly ContentTypeDefinition[], path: string): { apiId: string; value: string; param: DetailParam } | null {
  if (typeof path !== 'string') return null;
  for (const def of defs) {
    const parsed = detailEnabled(def);
    if (!parsed || !path.startsWith(`${parsed.prefix}/`)) continue;
    const value = path.slice(parsed.prefix.length + 1);
    if (!(parsed.param === 'id' ? UUID_RE : SLUG_RE).test(value)) continue;
    return { apiId: def.apiId, value, param: parsed.param };
  }
  return null;
}
