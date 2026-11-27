import { matchDetailPath, parseDetailPath, type ContentTypeDefinition, type DetailPageOptions, type DetailParam } from '@opencloudcms/schema';

export interface DetailState {
  /** The type's `detailPage` as declared (null when off). */
  config: DetailPageOptions | null;
  /** Parsed path when the detail page is usable (non-private, valid path, `{slug}` with a slug field). */
  usable: { prefix: string; param: DetailParam } | null;
  /** `detailPage` is set but cannot be served (decision 12: 404 at runtime, a warning in the admin). */
  misconfigured: boolean;
}

/** Detail page state of `def`. Same notion of "usable" as `matchDetailPath` in @opencloudcms/schema. */
export function detailState(def: ContentTypeDefinition): DetailState {
  const raw = def.detailPage;
  if (!raw || typeof raw !== 'object') return { config: null, usable: null, misconfigured: false };
  const config: DetailPageOptions = { path: raw.path, ...(raw.slugField !== undefined ? { slugField: raw.slugField } : {}) };
  const parsed = typeof raw.path === 'string' ? parseDetailPath(raw.path) : null;
  let usable = parsed && !def.private ? parsed : null;
  if (usable?.param === 'slug') {
    const field = def.fields.find((x) => x.name === raw.slugField);
    if (!field || field.kind !== 'slug') usable = null;
  }
  return { config, usable, misconfigured: !usable };
}

/** `{ [apiId]: { path, slugField? } }` of the usable detail pages (public: private types never appear). */
export function detailPaths(defs: readonly ContentTypeDefinition[]): Record<string, DetailPageOptions> {
  const out: Record<string, DetailPageOptions> = {};
  for (const def of defs) {
    const s = detailState(def);
    if (!s.usable || !s.config) continue;
    out[def.apiId] = s.usable.param === 'slug' ? { path: s.config.path, slugField: s.config.slugField } : { path: s.config.path };
  }
  return out;
}

export interface PageSaveWarning {
  code: 'page_hides_detail';
  message: string;
  apiId: string;
  path: string;
  value: string;
}

/** Spec §3 routing 4: an ordinary page at a path that a detail pattern matches hides that entry's detail page. */
export function pageHidesDetail(defs: readonly ContentTypeDefinition[], path: unknown): PageSaveWarning[] {
  if (typeof path !== 'string' || !path) return [];
  const m = matchDetailPath(defs, path);
  if (!m) return [];
  const pattern = defs.find((d) => d.apiId === m.apiId)!.detailPage!.path;
  return [
    {
      code: 'page_hides_detail',
      message: `This page hides ${pattern} for ${m.param} "${m.value}"`,
      apiId: m.apiId,
      path: pattern,
      value: m.value,
    },
  ];
}
