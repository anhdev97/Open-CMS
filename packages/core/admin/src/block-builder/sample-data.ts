// Sample data of the block builder canvas (spec §7.4): real draft entries through the admin content API with the
// block's fixed filter/sort/limit, a placeholder entry when there are none, and preview values of manual fields.
// Relative imports only (root vitest).
import { localizedText, type ComposedBinding, type ComposedField, type ComposedNode, type Locale } from '@opencloudcms/schema';
import type { ContentFetcher, Entry } from '@opencloudcms/core/blocks';
import type { ContentTypeDefinition } from '../lib/types';

/** Most entries the canvas repeats a collection template over. */
export const CANVAS_MAX = 12;
/** Entries listed for the sample picker of a single-entry block. */
export const SINGLE_CHOICES = 20;

/** List query for the samples: the block's fixed filter, sort and limit (collection) or the first entries (single). */
export function sampleQuery(b: ComposedBinding): { limit: number; sort?: string; filter: Record<string, string> } {
  if (b.mode === 'single') return { limit: SINGLE_CHOICES, filter: {} };
  const filter = Object.fromEntries((b.filter ?? []).map((f) => [f.field, String(f.value)]));
  return {
    limit: Math.min(b.limit ?? 12, CANVAS_MAX),
    ...(b.sort ? { sort: `${b.sort.field}:${b.sort.direction}` } : {}),
    filter,
  };
}

const today = () => new Date().toISOString().slice(0, 10);

/** An entry shaped like the content API's, with a visible value per field: shown when the type has no matching entries. */
export function placeholderEntry(ct: ContentTypeDefinition, locale: Locale | string): Entry {
  const now = new Date().toISOString();
  const e: Entry = { documentId: 'sample', createdAt: now, updatedAt: now, publishedAt: now };
  for (const f of ct.fields) {
    const label = f.label || f.name;
    switch (f.kind) {
      case 'text':
      case 'longText':
        e[f.name] = label;
        break;
      case 'slug':
        e[f.name] = 'sample';
        break;
      case 'email':
        e[f.name] = 'name@example.com';
        break;
      case 'url':
        e[f.name] = 'https://example.com';
        break;
      case 'richText':
        e[f.name] = `<p>${label.replace(/[<>&]/g, '')}</p>`;
        break;
      case 'number':
        e[f.name] = 42;
        break;
      case 'money':
        e[f.name] = { amount: 1234.5, currency: f.options?.currencyMode === 'fixed' && f.options?.currency ? f.options.currency : 'USD' };
        break;
      case 'boolean':
        e[f.name] = true;
        break;
      case 'date':
        e[f.name] = today();
        break;
      case 'datetime':
        e[f.name] = now;
        break;
      default:
        e[f.name] = null; // asset, reference, taxonomy, json: nothing meaningful to invent
    }
  }
  void locale;
  return e;
}

/** Preview values of the manual fields: their default, else a value that shows something. */
export function canvasFieldValues(fields: Record<string, ComposedField>, locale: Locale | string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, f] of Object.entries(fields)) {
    if (f.default !== undefined && f.kind !== 'image' && f.kind !== 'link') {
      out[name] = f.default;
      continue;
    }
    switch (f.kind) {
      case 'text':
      case 'longText':
        out[name] = localizedText(f.label as never, locale as Locale, name);
        break;
      case 'richText':
        out[name] = undefined;
        break;
      case 'number':
        out[name] = 0;
        break;
      case 'boolean':
        out[name] = true;
        break;
      case 'select':
        out[name] = f.options?.[0];
        break;
      case 'image':
        out[name] = null;
        break;
      case 'link':
        out[name] = { href: '#' };
        break;
    }
  }
  return out;
}

/** Entry paths bound to `Image.src`/`alt` (asset ids there are swapped for the asset, like `resolvePage` does). */
export function imageEntryPaths(n: ComposedNode, out = new Set<string>()): Set<string> {
  if (n.el === 'Image') for (const k of ['src', 'alt']) {
    const s = n.bind?.[k];
    if (s?.from === 'entry') out.add(s.path);
  }
  for (const c of n.children ?? []) imageEntryPaths(c, out);
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sample entries for `binding` in `locale`, asset ids at `assetPaths` resolved (one `assets()` call). */
export async function loadSamples(fetcher: ContentFetcher, binding: ComposedBinding, locale: string, assetPaths: readonly string[]): Promise<Entry[]> {
  const rows = await fetcher.query(binding.apiId, sampleQuery(binding), locale as Locale);
  const ids = new Set<string>();
  for (const r of rows) for (const p of assetPaths) if (typeof r[p] === 'string' && UUID.test(r[p] as string)) ids.add(r[p] as string);
  if (!ids.size || !fetcher.assets) return rows;
  const assets = new Map((await fetcher.assets([...ids]).catch(() => [])).map((a) => [a.id, a]));
  return rows.map((r) => {
    const copy: Entry = { ...r };
    for (const p of assetPaths) if (typeof r[p] === 'string' && assets.has(r[p] as string)) copy[p] = assets.get(r[p] as string)!;
    return copy;
  });
}
