import type { Server as HttpServer, IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import httpProxy from 'http-proxy';

export const STOREFRONT_UNAVAILABLE_MESSAGE = (target: string) =>
  `Storefront is unavailable (Next.js did not respond at ${target}). Is \`next dev\` / \`next start\` running?`;

export interface StorefrontProxyOptions {
  targetUrl: string;
  excludePrefixes?: string[];
}

export interface StorefrontProxy {
  handler: (req: Request, res: Response, next: NextFunction) => void;
  attach(server: HttpServer): void;
  close(): void;
}

const DEFAULT_EXCLUDE = ['/admin', '/api', '/oauth2'];

function pathnameOf(url: string | undefined): string {
  const path = (url ?? '/').split('?')[0] || '/';
  return path.startsWith('/') ? path : `/${path}`;
}

function isExcluded(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(p.endsWith('/') ? p : `${p}/`));
}

export function createStorefrontProxy(opts: StorefrontProxyOptions): StorefrontProxy {
  const targetUrl = opts.targetUrl.replace(/\/+$/, '');
  const excludePrefixes = opts.excludePrefixes ?? DEFAULT_EXCLUDE;
  const proxy = httpProxy.createProxyServer({ target: targetUrl, changeOrigin: true, ws: true, xfwd: true });

  const onError = (err: Error, _req: IncomingMessage, res: Socket | Response) => {
    if (res instanceof Socket) {
      res.destroy(err);
      return;
    }
    const expressRes = res as Response;
    if (expressRes.headersSent) return;
    expressRes.status(502).type('text/plain; charset=utf-8').send(STOREFRONT_UNAVAILABLE_MESSAGE(targetUrl));
  };
  proxy.on('error', onError as (...args: unknown[]) => void);

  const handler: StorefrontProxy['handler'] = (req, res, next) => {
    const pathname = pathnameOf(req.originalUrl ?? req.url);
    if (isExcluded(pathname, excludePrefixes)) {
      next();
      return;
    }
    proxy.web(req, res, { target: targetUrl });
  };

  let upgrade: ((req: IncomingMessage, socket: Socket, head: Buffer) => void) | undefined;
  let attached: HttpServer | undefined;

  return {
    handler,
    attach(server) {
      if (attached) return;
      attached = server;
      upgrade = (req, socket, head) => {
        const pathname = pathnameOf(req.url);
        if (isExcluded(pathname, excludePrefixes)) return;
        proxy.ws(req, socket, head, { target: targetUrl });
      };
      server.on('upgrade', upgrade);
    },
    close() {
      if (attached && upgrade) attached.off('upgrade', upgrade);
      attached = undefined;
      upgrade = undefined;
      proxy.close();
    },
  };
}
