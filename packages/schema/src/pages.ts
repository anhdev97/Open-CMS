// Pure, runtime-agnostic page helpers. Must not import from `node:*` (bundled for the browser and shared with Nest).

/** apiId of the core-owned page content type. Projects may not define a type with this id. */
export const PAGE_API_ID = 'opencloudcmsPage';

/** apiIds owned by core: hidden from the Content Type Builder and rejected in project schema files. */
export const CORE_API_IDS: readonly string[] = [PAGE_API_ID];

export const isCoreApiId = (apiId: string): boolean => CORE_API_IDS.includes(apiId);

/** First path segments that belong to the CMS itself (compared case-insensitively). */
export const RESERVED_PATH_SEGMENTS: readonly string[] = ['admin', 'api', '__opencloudcms', '_next'];

const SEGMENT_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type PagePathResult = { ok: true } | { ok: false; code: 'invalid_path' | 'path_reserved'; message: string };

export function validatePagePath(path: string): PagePathResult {
  if (typeof path !== 'string' || !path.startsWith('/')) {
    return { ok: false, code: 'invalid_path', message: 'Path must start with "/"' };
  }
  if (path === '/') return { ok: true };
  const segments = path.slice(1).split('/');
  if (RESERVED_PATH_SEGMENTS.includes(segments[0].toLowerCase())) {
    return { ok: false, code: 'path_reserved', message: `Path "/${segments[0]}" is reserved` };
  }
  if (!segments.every((s) => SEGMENT_RE.test(s))) {
    return {
      ok: false,
      code: 'invalid_path',
      message: 'Path segments must be lowercase letters, digits and single hyphens, separated by "/" with no trailing "/"',
    };
  }
  return { ok: true };
}

/** 'Giới thiệu' -> '/gioi-thieu'. */
export function slugToPath(title: string): string {
  const slug = String(title ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? `/${slug}` : '/';
}

export type StoredPageContent = {
  format: 'puck';
  formatVersion: number;
  data: { root: unknown; content: unknown[]; zones?: Record<string, unknown[]> };
};

export type BlockManifest = { name: string; version: number }[];

function isItem(v: unknown): v is { type: string; props?: unknown } {
  if (!v || typeof v !== 'object') return false;
  const o = v as { type?: unknown; props?: unknown };
  return typeof o.type === 'string' && !!o.props && typeof o.props === 'object' && !Array.isArray(o.props);
}

function walk(value: unknown, out: Map<string, number>): void {
  if (Array.isArray(value)) {
    for (const v of value) walk(v, out);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (isItem(value)) {
    out.set(value.type, (out.get(value.type) ?? 0) + 1);
    walk(value.props, out);
    return;
  }
  for (const v of Object.values(value)) walk(v, out);
}

/** Block name -> occurrences, over root content, zones and slot props. */
export function collectBlockNames(c: StoredPageContent | null | undefined): Map<string, number> {
  const out = new Map<string, number>();
  const data = c?.data;
  if (!data) return out;
  walk(data.content, out);
  for (const zone of Object.values(data.zones ?? {})) walk(zone, out);
  return out;
}
