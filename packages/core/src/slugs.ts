/**
 * Slug fields in the entry write path (spec §2; decisions 4, 7, 8, 10, 11, 13).
 *
 * - No pattern: the value is the entry's documentId. Read-only: a sent value other than the documentId (or the stored
 *   value, or empty) is 422 `slug_readonly`. Old entries keep a stored value; an empty one is filled on update.
 * - Pattern (`options.pattern`, legacy `from`): generated on create, and on update when the value is empty or was
 *   never edited by hand and a pattern source changed. "Edited by hand" is inferred (decision 7): the stored value is
 *   the pattern result of the old values, optionally with `-N`. A pattern that renders `''` falls back to the
 *   documentId. `{id6}` uses 8 hex characters when another entry's documentId starts with the same 6.
 * - Uniqueness per type and locale (localized: the l10n rows of that locale; shared: the main rows) across other
 *   entries' draft and published rows; generated duplicates get `-2`, `-3`…, typed ones are 422 `slug_taken`.
 *   Publishing re-checks other entries' published rows (409 `slug_taken`). All under a per-type advisory lock taken
 *   first in the write transaction.
 * - Grandfathered values: format and length are checked only when the value changes.
 */
import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { ContentTypeDefinition, FieldDefinition } from '@opencloudcms/schema';
import {
  fieldStorage, l10nTable, mainTable, parseSlugPattern, renderSlugPattern, slugPattern, SLUG_MAX_LENGTH, SLUG_RE, SYSTEM_TABLES,
} from '@opencloudcms/schema';
import type { PublishedDocument } from './options';

type Row = Record<string, unknown>;

export interface SlugWriteContext {
  /** Locale of the write (the l10n row it saves). */
  locale: string;
  defaultLocale: string;
}

const isEmpty = (v: unknown): boolean => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

export const slugFields = (def: ContentTypeDefinition): FieldDefinition[] => def.fields.filter((f) => f.kind === 'slug');

/** Whether any slug field of `def` has a pattern (only those need the lock and uniqueness checks). */
export const hasSlugPatterns = (def: ContentTypeDefinition): boolean => def.fields.some((f) => slugPattern(f) !== null);

const maxLengthOf = (f: FieldDefinition): number => (f.options as { maxLength?: number }).maxLength ?? SLUG_MAX_LENGTH;

/** The documentId, or its first hex characters when it does not fit `max`. */
const idFallback = (documentId: string, max: number): string =>
  documentId.length <= max ? documentId : documentId.replace(/-/g, '').slice(0, max);

/** Serializes slug generation and checks of one content type until the transaction ends. */
export async function lockSlugs(trx: Kysely<any>, def: ContentTypeDefinition): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtext('opencloudcms.slug.' || ${def.apiId}))`.execute(trx);
}

/**
 * `slug_readonly` (422), `slug_taken` (422 on a typed value, 409 on publish). The response body carries the field
 * `path` (and `locale` for a localized slug) next to `code`, `message` and `issues`; `SlugErrorFilter` in
 * content.controllers.ts renders it under `error`.
 */
export class SlugError extends HttpException {
  constructor(
    status: number,
    readonly code: 'slug_readonly' | 'slug_taken',
    message: string,
    readonly path: string,
    readonly locale?: string,
  ) {
    super(
      { code, message, path, ...(locale ? { locale } : {}), issues: [{ path, message: code === 'slug_taken' ? 'already used' : 'read-only', ...(locale ? { locale } : {}) }] },
      status,
    );
  }
}

const readOnlyError = (path: string) =>
  new SlugError(HttpStatus.UNPROCESSABLE_ENTITY, 'slug_readonly', `${path} has no pattern: its value is the entry id and cannot be set`, path);

const takenError = (status: number, path: string, value: string, locale?: string) =>
  new SlugError(status, 'slug_taken', `Slug "${value}" is already used by another entry`, path, locale);

/**
 * Before validation, on the raw body. `stored`: the draft read in the write locale (update), null on create.
 * Pattern-less fields: empty, the documentId or the stored value are dropped, anything else is 422 `slug_readonly`.
 * Pattern fields: the stored value sent back unchanged is dropped (so an old invalid value never fails validation and
 * an untouched slug follows its sources); `''` becomes null ("regenerate").
 */
export function prepareSlugInput(def: ContentTypeDefinition, body: unknown, documentId: string | null, stored: Row | null): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const src = body as Row;
  let out: Row | null = null;
  const edit = () => (out ??= { ...src });
  for (const f of slugFields(def)) {
    if (!(f.name in src)) continue;
    const v = src[f.name];
    if (slugPattern(f) === null) {
      if (isEmpty(v) || (documentId !== null && v === documentId) || (stored && !isEmpty(stored[f.name]) && v === stored[f.name])) {
        delete edit()[f.name];
        continue;
      }
      throw readOnlyError(f.name);
    }
    if (v === '') edit()[f.name] = null;
    else if (stored && !isEmpty(v) && v === stored[f.name]) delete edit()[f.name];
  }
  return out ?? src;
}

/** Values of `f` (draft or published document) per locale; shared fields under `null`. */
function storedSlugs(def: ContentTypeDefinition, f: FieldDefinition, doc: PublishedDocument | null): Map<string | null, string> {
  const out = new Map<string | null, string>();
  if (!doc) return out;
  if (f.localizable) {
    for (const [locale, t] of Object.entries(doc.translations)) if (!isEmpty(t[f.name])) out.set(locale, String(t[f.name]));
  } else if (!isEmpty(doc.shared[f.name])) out.set(null, String(doc.shared[f.name]));
  return out;
}

/**
 * Slug values of `f` held by other entries' rows (draft and published, or only `status`) in `locale` (ignored for
 * shared fields): equal to `value`, or with `prefix` also `value-…`.
 */
async function takenValues(
  trx: Kysely<any>, def: ContentTypeDefinition, f: FieldDefinition, locale: string, documentId: string, value: string,
  opts: { prefix?: boolean; status?: 'published' } = {},
): Promise<Set<string>> {
  const storage = fieldStorage(def, f);
  if (storage.mode !== 'columns') return new Set();
  const col = storage.columns[0].name;
  const ref = storage.location === 'main' ? `m.${col}` : `l.${col}`;
  let q = storage.location === 'main'
    ? trx.selectFrom(`${mainTable(def)} as m`)
    : trx.selectFrom(`${l10nTable(def)} as l`).innerJoin(`${mainTable(def)} as m`, 'm.id', 'l.entry_id').where('l.locale', '=', locale);
  q = q.where('m.document_id', '<>', documentId);
  if (opts.status) q = q.where('m.status', '=', opts.status);
  // Values are slugs ([a-z0-9-]) or documentIds: no LIKE wildcards to escape.
  q = q.where((eb) => (opts.prefix ? eb.or([eb(ref, '=', value), eb(ref, 'like', `${value}-%`)]) : eb(ref, '=', value)));
  const rows = await q.select(sql.ref(ref).as('v')).execute();
  return new Set(rows.map((r) => String((r as Row).v)));
}

/** `base`, or `base-2`, `base-3`… (cut to fit `max`), the first one no other entry uses. */
async function freeSlug(
  trx: Kysely<any>, def: ContentTypeDefinition, f: FieldDefinition, locale: string, documentId: string, base: string, max: number,
): Promise<string> {
  const taken = await takenValues(trx, def, f, locale, documentId, base, { prefix: true });
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const head = base.slice(0, Math.max(max - suffix.length, 0)).replace(/-+$/, '');
    const candidate = `${head}${suffix}`;
    // A cut head is not covered by the prefix query: ask for it exactly.
    const used = candidate.startsWith(`${base}-`)
      ? taken.has(candidate)
      : (await takenValues(trx, def, f, locale, documentId, candidate)).has(candidate);
    if (!used) return candidate;
  }
}

/** 8 when another entry's documentId starts with the same 6 hex characters (so `{id6}` stays unambiguous), else 6. */
async function idLength(trx: Kysely<any>, def: ContentTypeDefinition, documentId: string): Promise<number> {
  const hex6 = documentId.replace(/-/g, '').slice(0, 6).toLowerCase();
  const row = await trx
    .selectFrom(mainTable(def))
    .select('document_id')
    .where(sql<boolean>`document_id::text like ${`${hex6}%`}`)
    .where('document_id', '<>', documentId)
    .limit(1)
    .executeTakeFirst();
  return row ? 8 : 6;
}

/** Term labels by id, in `locale` (then the default locale, then any). */
async function termNames(trx: Kysely<any>, ids: string[], locale: string, defaultLocale: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const rows = await trx.selectFrom(SYSTEM_TABLES.taxonomyTerms).select(['id', 'name']).where('id', 'in', ids).execute();
  for (const r of rows) {
    const name = (typeof r.name === 'string' ? JSON.parse(r.name) : r.name) as Record<string, unknown> | null;
    const label = name?.[locale] ?? name?.[defaultLocale] ?? Object.values(name ?? {}).find((v) => typeof v === 'string');
    if (typeof label === 'string') out.set(String(r.id), label);
  }
  return out;
}

/**
 * Values of the pattern's source fields for a slug read in `target`: `data` (this write) over `previous`; localized
 * sources empty in `target` fall back to the other locale of the write (the default locale for a localized slug,
 * decision 11's write locale for a shared one). `withData: false` gives the old values.
 */
async function sourceValues(
  trx: Kysely<any>, def: ContentTypeDefinition, pattern: string, previous: PublishedDocument | null, data: Row, withData: boolean,
  target: string, ctx: SlugWriteContext,
): Promise<Row> {
  const names = parseSlugPattern(pattern, def).parts.flatMap((p) => (p.kind === 'field' ? [p.name] : []));
  const fallback = target === ctx.defaultLocale ? ctx.locale : ctx.defaultLocale;
  const valueIn = (f: FieldDefinition, locale: string): unknown => {
    if (!f.localizable) return withData && f.name in data ? data[f.name] : previous?.shared[f.name];
    if (withData && locale === ctx.locale && f.name in data) return data[f.name];
    return previous?.translations[locale]?.[f.name];
  };
  const values: Row = {};
  const termIds: string[] = [];
  for (const name of names) {
    const f = def.fields.find((x) => x.name === name);
    if (!f) continue;
    let v = valueIn(f, target);
    if (isEmpty(v) && f.localizable) v = valueIn(f, fallback);
    if (f.kind === 'taxonomy') {
      const first = Array.isArray(v) ? v[0] : v;
      v = typeof first === 'string' ? first : null;
      if (v) termIds.push(v as string);
    }
    values[name] = v;
  }
  if (termIds.length) {
    const labels = await termNames(trx, [...new Set(termIds)], target, ctx.defaultLocale);
    for (const name of names) {
      const f = def.fields.find((x) => x.name === name);
      if (f?.kind === 'taxonomy' && typeof values[name] === 'string') values[name] = { name: labels.get(values[name] as string) ?? '' };
    }
  }
  return values;
}

/** Whether `stored` looks generated from `base` (equal, or `base-N`). */
const followsPattern = (stored: string, base: string): boolean =>
  stored === base || (stored.startsWith(`${base}-`) && /^[1-9]\d*$/.test(stored.slice(base.length + 1)));

/**
 * Runs first in the create/update transaction (after `lockSlugs` for types with patterns) and returns the data to
 * write. `previous`: the draft read in the transaction, null on create. A slug is only written where this save writes
 * anyway: a localized slug only when the write locale's l10n row exists or is being written.
 */
export async function applySlugs(
  trx: Kysely<any>, def: ContentTypeDefinition, documentId: string, data: Row, previous: PublishedDocument | null, ctx: SlugWriteContext,
): Promise<Row> {
  const fields = slugFields(def);
  if (!fields.length) return data;
  const out: Row = { ...data };
  const writesL10n = !!previous?.translations[ctx.locale] || def.fields.some((f) => f.localizable && f.name in data);
  for (const f of fields) {
    if (f.localizable && !writesL10n) continue;
    const max = maxLengthOf(f);
    const stored = (f.localizable ? previous?.translations[ctx.locale]?.[f.name] : previous?.shared[f.name]) ?? null;
    const pattern = slugPattern(f);

    if (pattern === null) {
      delete out[f.name];
      if (isEmpty(stored)) out[f.name] = idFallback(documentId, max);
      continue;
    }

    // Uniqueness scope: the write locale for a localized slug; shared slugs are compared across main rows.
    const scope = ctx.locale;
    const sent = f.name in data ? data[f.name] : undefined;
    if (!isEmpty(sent) && sent !== stored) {
      const value = String(sent);
      if (!SLUG_RE.test(value) || value.length > max) {
        throw new BadRequestException({
          message: `Invalid ${def.apiId} data`,
          issues: [{ path: f.name, message: `must be a lowercase slug like "my-product" of at most ${max} characters` }],
        });
      }
      if ((await takenValues(trx, def, f, scope, documentId, value)).has(value)) {
        throw takenError(HttpStatus.UNPROCESSABLE_ENTITY, f.name, value, f.localizable ? ctx.locale : undefined);
      }
      out[f.name] = value;
      continue;
    }

    // Sources are read in the write locale (localized slug) or the default locale (shared slug, decision 11).
    const target = f.localizable ? ctx.locale : ctx.defaultLocale;
    const render = (values: Row, idLen: number) =>
      renderSlugPattern(pattern, values, documentId, target, max, idLen) || idFallback(documentId, max);
    const next = await sourceValues(trx, def, pattern, previous, data, true, target, ctx);
    // An explicit empty value asks for the pattern again; an empty stored value is filled (decision 10).
    const regenerate = (f.name in data && isEmpty(sent)) || isEmpty(stored);
    if (!regenerate) {
      const old = await sourceValues(trx, def, pattern, previous, data, false, target, ctx);
      const generated = [6, 8].some((n) => followsPattern(String(stored), render(old, n)));
      // Edited by hand, or no source changed: keep the stored value (and its suffix).
      if (!generated || render(next, 6) === render(old, 6)) {
        delete out[f.name];
        continue;
      }
    }
    const idLen = pattern.includes('{id6}') ? await idLength(trx, def, documentId) : 6;
    out[f.name] = await freeSlug(trx, def, f, scope, documentId, render(next, idLen), max);
  }
  return out;
}

/**
 * Publish re-check (decision 8), under `lockSlugs`: each draft slug must not be in another entry's published row of
 * the same locale, unless this entry's published row already had it (an old duplicate is not a new conflict).
 * 409 `slug_taken`.
 */
export async function checkPublishSlugs(
  trx: Kysely<any>, def: ContentTypeDefinition, documentId: string, draft: PublishedDocument | null, published: PublishedDocument | null,
): Promise<void> {
  for (const f of slugFields(def)) {
    if (slugPattern(f) === null) continue;
    const own = storedSlugs(def, f, published);
    for (const [locale, value] of storedSlugs(def, f, draft)) {
      if (own.get(locale) === value) continue;
      const taken = await takenValues(trx, def, f, locale ?? '', documentId, value, { status: 'published' });
      if (taken.has(value)) throw takenError(HttpStatus.CONFLICT, f.name, value, locale ?? undefined);
    }
  }
}
