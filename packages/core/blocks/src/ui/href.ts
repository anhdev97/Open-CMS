// Allow-list for link targets rendered by blocks: anything that is not plainly a web/mail/phone link or a same-site
// path becomes `null` (rendered as a non-link), so stored or entry data can never produce `javascript:` and the like.
const SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i;
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

/**
 * `href` trimmed when it is `http:`, `https:`, `mailto:`, `tel:`, a root-relative path (`/x`, but not `//host` or
 * `/\host`), a fragment (`#x`) or a query (`?x`); otherwise `null`. Tab, CR and LF are removed first (browsers
 * ignore them in URLs, so `/<TAB>/evil.com` would otherwise reach `//evil.com`).
 */
export function safeHref(href: unknown): string | null {
  if (typeof href !== 'string') return null;
  const s = href.replace(/[\t\n\r]/g, '').trim();
  if (!s) return null;
  if (s[0] === '/') return s[1] === '/' || s[1] === '\\' ? null : s;
  if (s[0] === '#' || s[0] === '?') return s;
  const m = SCHEME_RE.exec(s);
  return m && SAFE_SCHEMES.has(m[1].toLowerCase()) ? s : null;
}
