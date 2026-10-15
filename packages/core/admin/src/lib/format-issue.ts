/** One validation issue as `path: message` (string issues as-is, `[locale]` prefix when present, JSON for anything else). */
export function formatIssue(issue: unknown): string {
  if (typeof issue === 'string') return issue;
  if (issue !== null && typeof issue === 'object') {
    const i = issue as { path?: unknown; message?: unknown; locale?: unknown };
    if (typeof i.message === 'string') {
      const locale = typeof i.locale === 'string' && i.locale ? `[${i.locale}] ` : '';
      const path = typeof i.path === 'string' && i.path ? `${i.path}: ` : '';
      return `${locale}${path}${i.message}`;
    }
  }
  return JSON.stringify(issue) ?? String(issue);
}
