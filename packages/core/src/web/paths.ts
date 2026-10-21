const matches = (path: string, base: string): boolean => {
  const p = path.toLowerCase();
  return p === base || p.startsWith(base + '/');
};

/** Paths owned by the Nest backend (REST API and the OIDC provider); the web host never answers them. */
export const isBackendPath = (path: string): boolean => matches(path, '/api') || matches(path, '/oauth2');

/**
 * Paths of the admin UI, which get the nonce CSP. Decided on the pathname as Next will see it (percent-decoded,
 * repeated slashes collapsed), so `/%61dmin` and `//admin` count. A malformed escape fails closed: it counts as admin.
 */
export const isAdminPath = (rawPath: string): boolean => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return true;
  }
  return matches(decoded.replace(/\/{2,}/g, '/'), '/admin');
};
