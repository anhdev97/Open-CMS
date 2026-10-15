import { createHash } from 'node:crypto';
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

/** CSP for index.html: the base policy plus `script-src 'self'` and one sha256 per inline <script> (the pre-paint theme script). */
function cspFor(html: string): string {
  const hashes: string[] = [];
  for (const m of html.matchAll(/<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (m[1].trim() === '') continue;
    hashes.push(`'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
  }
  return `${SECURITY_HEADERS['Content-Security-Policy']}; script-src 'self'${hashes.length ? ' ' + hashes.join(' ') : ''}`;
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
    res.set({ ...SECURITY_HEADERS, 'Content-Security-Policy': cspFor(html.toString('utf8')), 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': String(html.length) });
    res.end(method === 'HEAD' ? undefined : html);
  };
}

export interface AdminDevOptions {
  /** Directory of the admin Vite project (holds vite.config.mts and index.html). */
  root: string;
  /** The Nest HTTP server; Vite attaches its HMR websocket to it. */
  httpServer: import('node:http').Server;
}

export interface AdminDevHandler {
  handler: (req: Request, res: Response, next: (err?: unknown) => void) => void;
  close(): Promise<void>;
}

/** The slice of Vite's dev server used here (the types of `vite` do not resolve under moduleResolution node). */
interface ViteDevServer {
  middlewares: (req: Request, res: Response, next: (err?: unknown) => void) => void;
  close(): Promise<void>;
}

// A variable specifier keeps tsc from resolving vite's types. Under CommonJS it compiles to require(), which loads
// vite's ESM build on Node >= 22 (require(esm)).
const VITE = 'vite';
const loadVite = (): Promise<{ createServer(config: Record<string, unknown>): Promise<ViteDevServer> }> => import(VITE);

/**
 * Dev UI mode: Vite in middleware mode, mounted at `/admin`. `vite` is imported lazily, only here, so installed
 * packages without devDependencies never load it. Rejects when `vite` cannot be imported. The production CSP is
 * deliberately not applied: Vite's index.html carries inline module scripts (HMR client, react-refresh preamble).
 */
export async function createAdminDevHandler(opts: AdminDevOptions): Promise<AdminDevHandler> {
  const { createServer } = await loadVite();
  const vite = await createServer({
    root: opts.root,
    configFile: path.join(opts.root, 'vite.config.mts'),
    base: '/admin/',
    server: { middlewareMode: true, hmr: { server: opts.httpServer } },
    appType: 'spa',
    logLevel: 'warn',
  });
  return {
    handler: (req, res, next) => {
      // `use('/admin')` stripped the mount point; Vite's base handling wants the full URL.
      req.url = req.originalUrl;
      vite.middlewares(req, res, next);
    },
    close: () => vite.close(),
  };
}
