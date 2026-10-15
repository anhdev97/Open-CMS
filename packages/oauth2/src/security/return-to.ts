const DEFAULT = '/admin';

export function sanitizeReturnTo(v: string | undefined): string {
  if (typeof v !== 'string' || !v.startsWith('/admin')) return DEFAULT;
  const next = v.charAt('/admin'.length);
  if (next !== '' && next !== '/' && next !== '?' && next !== '#') return DEFAULT;
  if (v.includes('\\') || v.includes('//')) return DEFAULT;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(v)) return DEFAULT;
  return v;
}
