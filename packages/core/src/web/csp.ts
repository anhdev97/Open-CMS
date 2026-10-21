import { randomBytes } from 'node:crypto';

export const createNonce = (): string => randomBytes(16).toString('base64');

/** CSP for admin pages. Dev adds what Next's dev server needs: eval for HMR and websockets. */
export function adminCsp(nonce: string, dev: boolean): string {
  const script = `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`;
  const csp = `default-src 'self'; ${script}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; frame-ancestors 'none'`;
  return dev ? `${csp}; connect-src 'self' ws: wss:` : csp;
}

export const ADMIN_SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex',
};
