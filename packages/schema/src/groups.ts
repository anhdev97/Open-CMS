import { isLocale, type LocalizedText } from './i18n';

export interface ContentGroupDefinition {
  key: string;
  title: LocalizedText;
  order?: number;
}

export const GROUP_KEY_RE = /^[a-z][a-z0-9-]{0,63}$/;

/** Returns issue messages; empty when valid. */
export function validateContentGroups(groups: unknown): string[] {
  if (!Array.isArray(groups)) return ['content groups must be a list'];
  const issues: string[] = [];
  const seen = new Set<string>();
  groups.forEach((g, i) => {
    const key = g && typeof g === 'object' ? (g as any).key : undefined;
    const where = `content group ${typeof key === 'string' ? `"${key}"` : `#${i}`}`;
    if (!g || typeof g !== 'object') return void issues.push(`${where}: must be an object`);
    if (typeof key !== 'string' || !GROUP_KEY_RE.test(key)) issues.push(`${where}: key must match ${GROUP_KEY_RE}`);
    else if (seen.has(key)) issues.push(`${where}: duplicate key`);
    else seen.add(key);
    issues.push(...validateLocalizedText((g as any).title, `${where}: title`));
    const order = (g as any).order;
    if (order !== undefined && !Number.isInteger(order)) issues.push(`${where}: order must be an integer`);
  });
  return issues;
}

/** Shared by group titles and content type display names. */
export function validateLocalizedText(v: unknown, label: string): string[] {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return [`${label} must be an object with an "en-US" entry`];
  const issues: string[] = [];
  const t = v as Record<string, unknown>;
  if (typeof t['en-US'] !== 'string' || !t['en-US'].trim()) issues.push(`${label} requires a non-empty "en-US" entry`);
  for (const [k, val] of Object.entries(t)) {
    if (!isLocale(k)) issues.push(`${label} has unsupported locale "${k}"`);
    else if (typeof val !== 'string') issues.push(`${label}["${k}"] must be a string`);
  }
  return issues;
}

export function defineContentGroups(groups: ContentGroupDefinition[]): ContentGroupDefinition[] {
  const issues = validateContentGroups(groups);
  if (issues.length) throw new Error(`Invalid content groups:\n  - ${issues.join('\n  - ')}`);
  return groups;
}
