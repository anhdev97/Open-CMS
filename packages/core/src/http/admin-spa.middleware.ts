import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Request, Response } from 'express';

/** Built admin UI. tsc emits this file to dist/http/, so this is dist/admin, which holds only Vite's output. */
export const DEFAULT_ADMIN_DIST_DIR = path.join(__dirname, '..', 'admin');

const IMMUTABLE = 'public, max-age=31536000, immutable';
const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
};
const NOT_BUILT_HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Admin UI</title></head>' +
  '<body><p>Admin UI chưa được build. Chạy <code>pnpm build</code> trong <code>@opencms/core</code>.</p></body></html>';

export interface AdminSpaOptions {
  distDir: string;
  logger: { warn(msg: string): void };
}

/** Real path of `file` when it is a regular file inside `root` (symlinks resolved), otherwise undefined. */
function resolveInside(root: string, file: string): string | undefined {
  try {
    const real = fs.realpathSync(file);
    if (!real.startsWith(root + path.sep)) return undefined;
    return fs.statSync(real).isFile() ? real : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Express handler for the embedded admin SPA; mount it at `/admin`. Static files come only from `distDir`;
 * `..` (also encoded) and symlinks leaving it are never followed.
 */
export function createAdminSpaHandler(opts: AdminSpaOptions): (req: Request, res: Response) => void {
  let warned = false;
  const warnOnce = () => {
    if (warned) return;
    warned = true;
    opts.logger.warn(`Admin UI is not built (no index.html in ${opts.distDir}); /admin answers 503. Run \`pnpm build\` in @opencms/core.`);
  };
  const rootOf = (): string | undefined => {
    try {
      return fs.realpathSync(opts.distDir);
    } catch {
      return undefined;
    }
  };
  if (!resolveIndex()) warnOnce();

  function resolveIndex(): string | undefined {
    const root = rootOf();
    return root ? resolveInside(root, path.join(root, 'index.html')) : undefined;
  }

  return (req, res) => {
    const method = req.method;
    // `use('/admin')` strips the mount point: url is '/', '/assets/x' ... (+ query).
    const q = req.url.indexOf('?');
    const rawPath = q === -1 ? req.url : req.url.slice(0, q);
    const search = q === -1 ? '' : req.url.slice(q);

    if (method !== 'GET' && method !== 'HEAD') {
      res.status(405).set('Allow', 'GET, HEAD').type('text/plain').send('Method Not Allowed');
      return;
    }
    if (rawPath === '' || (rawPath === '/' && !req.originalUrl.split('?')[0].endsWith('/'))) {
      res.redirect(308, `/admin/${search}`);
      return;
    }

    const root = rootOf();
    const index = root ? resolveInside(root, path.join(root, 'index.html')) : undefined;
    if (!root || !index) {
      warnOnce();
      res.status(503).set('Cache-Control', 'no-store').type('text/html; charset=utf-8').send(NOT_BUILT_HTML);
      return;
    }

    let decoded: string;
    try {
      decoded = decodeURIComponent(rawPath);
    } catch {
      res.status(400).type('text/plain').send('Bad Request');
      return;
    }
    if (decoded.includes('\0')) {
      res.status(400).type('text/plain').send('Bad Request');
      return;
    }

    if (decoded.startsWith('/assets/')) {
      const file = resolveInside(root, path.join(root, decoded));
      if (!file) {
        res.status(404).type('text/plain').send('Not Found');
        return;
      }
      res.sendFile(file, { dotfiles: 'allow', cacheControl: false, headers: { 'Cache-Control': IMMUTABLE } }, (err) => {
        if (err && !res.headersSent) res.status(404).type('text/plain').send('Not Found');
      });
      return;
    }

    // Every other path is a client-side route.
    const html = fs.readFileSync(index);
    res.status(200);
    res.set({ ...SECURITY_HEADERS, 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': String(html.length) });
    res.end(method === 'HEAD' ? undefined : html);
  };
}
