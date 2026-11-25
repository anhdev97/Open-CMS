// Readers for values bound into composed blocks: entry fields as the content API returns them and resolved manual
// field values. Shapes checked against `GET /api/admin/content/:apiId` (core/test/integration/content-values.test.ts):
// - money    → `{ amount: number, currency: string }` (or null)
// - date     → `'YYYY-MM-DD'`; datetime → ISO string in UTC (`…Z`)
// - boolean  → `true | false` (or null)
// - asset    → the asset id (uuid string) for a single asset. `resolvePage` replaces ids at the block's
//              `entryAssetPaths` by `{ id, url, alt, width, height }` (ContentFetcher.assets); an unresolved id renders
//              nothing. URL strings (`url` fields) and resolved `b.image` values (`{ src, alt }`) render too.
//              A multiple asset field (array of ids) renders its first asset: `resolvePage` replaces it by that asset.
import { safeHref } from '../ui/href';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Only web URLs and same-site paths are image sources (`safeHref` minus mailto/tel/#/?). */
function imageSrc(v: unknown): string | null {
  const s = safeHref(v);
  return s && (s[0] === '/' || /^https?:/i.test(s)) ? s : null;
}

/** `{ src, alt }` from a URL string or an object with `url`/`src` (and `alt`); a bare asset id or anything else → null. */
export function readEntryImage(v: unknown): { src: string; alt: string } | null {
  if (Array.isArray(v)) return v.length ? readEntryImage(v[0]) : null; // multiple asset field: its first asset
  if (typeof v === 'string') {
    const src = imageSrc(v);
    return src ? { src, alt: '' } : null;
  }
  if (isObj(v)) {
    const src = imageSrc(typeof v.url === 'string' ? v.url : v.src);
    return src ? { src, alt: typeof v.alt === 'string' ? v.alt : '' } : null;
  }
  return null;
}

const toNumber = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/** Money `{ amount, currency }`, a number or a numeric string → `{ value, currency? }`; else null. */
export function readEntryMoney(v: unknown): { value: number; currency?: string } | null {
  if (isObj(v)) {
    const value = toNumber(v.amount);
    if (value === null) return null;
    return typeof v.currency === 'string' && v.currency.trim() ? { value, currency: v.currency.trim() } : { value };
  }
  const value = toNumber(v);
  return value === null ? null : { value };
}

/** Text for headings, labels and badges: strings as-is, finite numbers as digits, everything else empty. */
export function readText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

/** Link target from a string or a resolved `b.link` (`{ href }`), through `safeHref`. */
export function readHref(v: unknown): string | null {
  return safeHref(isObj(v) ? v.href : v);
}

/** Date/datetime value for `DateText`: ISO strings, `YYYY-MM-DD` or epoch milliseconds. */
export function readDate(v: unknown): string | number | null {
  return typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) ? v : null;
}

/**
 * `showIf` presence: null/undefined, empty or blank strings, `false`, empty arrays, a link without `href`, an image
 * without `src` and money without `amount` are absent; `0` is present.
 */
export function isPresent(v: unknown): boolean {
  if (v === null || v === undefined || v === false) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  if (isObj(v)) {
    if ('href' in v) return isPresent(v.href);
    if ('src' in v) return isPresent(v.src);
    if ('amount' in v) return isPresent(v.amount);
  }
  return true;
}

const PLACEHOLDER_RE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * `urlPattern` (`/products/{slug}`) with each placeholder replaced by the URL-encoded value of that entry field
 * (string or finite number). Any missing/empty value → null (no link). `read` reports missing paths.
 */
export function entryUrl(pattern: string, read: (path: string) => unknown): string | null {
  let ok = true;
  const out = pattern.replace(PLACEHOLDER_RE, (_, name: string) => {
    const v = read(name);
    const s = typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
    if (!s) ok = false;
    return encodeURIComponent(s);
  });
  return ok ? safeHref(out) : null;
}
