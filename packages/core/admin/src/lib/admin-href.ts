/** Maps an admin-relative path (`/builder?type=a`) to its public URL (`/admin/builder?type=a`). */
export function adminHref(to: string): string {
  if (to === '/admin' || to.startsWith('/admin/') || to.startsWith('/admin?')) return to;
  const rest = to.startsWith('/') ? to : `/${to}`;
  return rest === '/' ? '/admin' : `/admin${rest}`;
}
