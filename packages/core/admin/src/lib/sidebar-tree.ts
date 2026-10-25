import { localizedText, type ContentGroupDefinition, type Locale, type LocalizedText } from '@opencloudcms/schema';

export const UNGROUPED_KEY = '__ungrouped';

export interface SidebarTypeInput {
  apiId: string;
  displayName: string | LocalizedText;
  group?: string;
}

export interface SidebarGroupNode {
  key: string;
  /** Empty for the ungrouped entry; the caller supplies its translated label. */
  title: string;
  items: { apiId: string; title: string }[];
}

/** Content groups -> sidebar tree. Pure: sorted by group order (missing last) then title; empty groups omitted. */
export function buildSidebarTree(
  types: SidebarTypeInput[],
  groups: ContentGroupDefinition[],
  locale: Locale,
): SidebarGroupNode[] {
  const cmp = (a: string, b: string) => a.localeCompare(b, locale);
  const known = new Set(groups.map((g) => g.key));
  const toItem = (ty: SidebarTypeInput) => ({ apiId: ty.apiId, title: localizedText(ty.displayName, locale, ty.apiId) });
  const byTitle = (a: { title: string }, b: { title: string }) => cmp(a.title, b.title);

  const nodes = groups
    .map((g) => ({
      order: g.order ?? Number.POSITIVE_INFINITY,
      node: {
        key: g.key,
        title: localizedText(g.title, locale, g.key),
        items: types.filter((ty) => ty.group === g.key).map(toItem).sort(byTitle),
      } as SidebarGroupNode,
    }))
    .filter((x) => x.node.items.length > 0)
    .sort((a, b) => (a.order === b.order ? cmp(a.node.title, b.node.title) : a.order < b.order ? -1 : 1))
    .map((x) => x.node);

  const loose = types.filter((ty) => !ty.group || !known.has(ty.group)).map(toItem);
  if (loose.length) nodes.push({ key: UNGROUPED_KEY, title: '', items: loose });
  return nodes;
}
