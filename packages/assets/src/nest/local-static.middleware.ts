import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import type { LocalAssetsConfig } from '../types';

/** URL path prefix (no trailing slash) of `publicBaseUrl`, or '' when it is served from the origin root. */
export function localStaticPrefix(cfg: LocalAssetsConfig): string {
  let pathname: string;
  try {
    pathname = new URL(cfg.publicBaseUrl).pathname;
  } catch {
    pathname = cfg.publicBaseUrl.startsWith('/') ? cfg.publicBaseUrl : `/${cfg.publicBaseUrl}`;
  }
  return pathname.replace(/\/+$/, '');
}

/** Serves files under `local.root` at the pathname of `local.publicBaseUrl` (GET/HEAD only). */
export function createLocalStaticMiddleware(cfg: LocalAssetsConfig) {
  const prefix = localStaticPrefix(cfg);
  const root = path.resolve(cfg.root);
  return (req: Request, res: Response, next: NextFunction): void => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || !prefix) return next();
    // Nest mounts middleware via app.use(), which rewrites req.path; use the original URL.
    const p = (req.originalUrl ?? req.url).split('?')[0];
    if (!p.startsWith(`${prefix}/`)) return next();
    let rel: string;
    try {
      rel = decodeURIComponent(p.slice(prefix.length + 1));
    } catch {
      return next();
    }
    if (!rel || rel.includes('\0')) return next();
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(rel, { root, dotfiles: 'deny' }, (err) => {
      if (err) {
        res.removeHeader('Cache-Control');
        if (!res.headersSent) next();
      }
    });
  };
}
