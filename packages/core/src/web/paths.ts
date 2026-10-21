const matches = (path: string, base: string): boolean => {
  const p = path.toLowerCase();
  return p === base || p.startsWith(base + '/');
};

/** Paths owned by the Nest backend (REST API and the OIDC provider); the web host never answers them. */
export const isBackendPath = (path: string): boolean => matches(path, '/api') || matches(path, '/oauth2');

/** Paths of the admin UI, which get the nonce CSP. */
export const isAdminPath = (path: string): boolean => matches(path, '/admin');
