const matches = (path: string, base: string): boolean => {
  const p = path.toLowerCase();
  return p === base || p.startsWith(base + '/');
};

/** Paths owned by the Nest backend (REST API and the OIDC provider); the web host never answers them. */
export const isBackendPath = (path: string): boolean => matches(path, '/api') || matches(path, '/oauth2');

/** Collapses repeated slashes (backslash counts as a slash) and resolves `.` / `..` segments. */
const resolveSegments = (path: string): string => {
  const out: string[] = [];
  for (const seg of path.replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return '/' + out.join('/');
};

/**
 * Paths of the admin UI, which get the nonce CSP. Decided on the pathname as Next will resolve it: dot segments
 * are resolved, then the path is percent-decoded and dot segments are resolved again (so `%2e%2e` counts), and
 * repeated slashes are collapsed. `/x/../admin`, `/x/%2e%2e/admin`, `/%61dmin` and `//admin` all count as admin;
 * `/administrator` does not. A malformed escape fails closed: it counts as admin.
 */
export const isAdminPath = (rawPath: string): boolean => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(resolveSegments(rawPath));
  } catch {
    return true;
  }
  return matches(resolveSegments(decoded), '/admin');
};
