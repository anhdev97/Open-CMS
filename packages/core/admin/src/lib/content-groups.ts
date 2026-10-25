import type { ContentGroupDefinition, Locale, LocalizedText } from '@opencloudcms/schema';
import { api } from './api';

export type LocaleInputs = Partial<Record<Locale, string>>;

/**
 * Form inputs -> stored value. Trims, drops empty non-en-US values, and returns a plain string when only
 * en-US is filled (keeps schema files minimal). An empty en-US is kept so server validation can reject it.
 */
export function toLocalizedText(values: LocaleInputs): string | LocalizedText {
  const out: Partial<Record<Locale, string>> = { 'en-US': (values['en-US'] ?? '').trim() };
  for (const [code, v] of Object.entries(values) as [Locale, string | undefined][]) {
    if (code === 'en-US') continue;
    const trimmed = (v ?? '').trim();
    if (trimmed) out[code] = trimmed;
  }
  return Object.keys(out).length === 1 ? out['en-US']! : (out as LocalizedText);
}

/** Stored value -> form inputs (always has en-US). */
export function fromLocalizedText(v: string | LocalizedText | undefined): LocaleInputs {
  if (typeof v === 'string') return { 'en-US': v };
  return { 'en-US': '', ...(v ?? {}) };
}

/** Number of content types per group key (every group present, unknown/missing groups ignored). */
export function groupUsage(groups: { key: string }[], types: { group?: string }[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(groups.map((g) => [g.key, 0]));
  for (const ty of types) if (ty.group !== undefined && ty.group in out) out[ty.group]!++;
  return out;
}

export interface ContentGroupsResponse {
  groups: ContentGroupDefinition[];
  editable: boolean;
}

export const fetchContentGroups = () => api<ContentGroupsResponse>('/api/admin/content-groups');

export const saveContentGroups = (groups: ContentGroupDefinition[]) =>
  api<{ groups: ContentGroupDefinition[] }>('/api/admin/content-groups', { method: 'PUT', json: { groups } });
