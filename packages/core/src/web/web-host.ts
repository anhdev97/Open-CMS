import * as fs from 'node:fs';
import type * as http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import * as path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { ADMIN_SECURITY_HEADERS, adminCsp, createNonce } from './csp';
import { isAdminPath, isBackendPath } from './paths';

/** The slice of a Next app used here (next's own types are not imported: it is an optional peer). */
export interface NextAppLike {
  prepare(): Promise<void>;
  getRequestHandler(): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  getUpgradeHandler(): (req: IncomingMessage, socket: Duplex, head: Buffer) => unknown;
  close?(): Promise<void>;
}
export type LoadNext = (opts: { dev: boolean; dir: string }) => NextAppLike;

export interface WebHostOptions {
  dir: string;
  dev: boolean;
  logger: { log(m: string): void; warn(m: string): void; error(m: string): void };
  loadNext?: LoadNext;
}

export interface WebHost {
  /** Never rejects; on failure the host answers 503. */
  prepare(): Promise<void>;
  handler: (req: Request, res: Response, next: NextFunction) => void;
  attachUpgrade(server: http.Server): void;
  close(): Promise<void>;
}

const NOT_BUILT = 'Web UI chưa được build. Chạy `pnpm build` rồi khởi động lại.';

// A variable specifier keeps tsc from resolving next's types; next is loaded from the project, not from core.
export const defaultLoadNext: LoadNext = ({ dev, dir }) => {
  const spec = 'next';
  const factory = require(require.resolve(spec, { paths: [dir] }));
  return (factory.default ?? factory)({ dev, dir });
};

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function createWebHost(opts: WebHostOptions): WebHost {
  const { dir, dev, logger } = opts;
  const loadNext = opts.loadNext ?? defaultLoadNext;
  let app: NextAppLike | undefined;
  let requestHandler: ((req: IncomingMessage, res: ServerResponse) => Promise<void>) | undefined;
  let upgradeHandler: ((req: IncomingMessage, socket: Duplex, head: Buffer) => unknown) | undefined;
  let warned = false;

  const warnNotBuilt = () => {
    if (warned) return;
    warned = true;
    logger.warn(`Web UI is not built (no .next/BUILD_ID in ${dir}); non-API paths answer 503. Run \`pnpm build\`.`);
  };

  async function prepare(): Promise<void> {
    if (!dev && !fs.existsSync(path.join(dir, '.next', 'BUILD_ID'))) {
      warnNotBuilt();
      return;
    }
    try {
      const candidate = loadNext({ dev, dir });
      await candidate.prepare();
      app = candidate;
      requestHandler = candidate.getRequestHandler();
      upgradeHandler = candidate.getUpgradeHandler();
      logger.log(`Web UI ready (${dev ? 'dev' : 'production'}) from ${dir}`);
    } catch (e) {
      logger.error(`Web UI failed to start: ${messageOf(e)}`);
      requestHandler = undefined;
      upgradeHandler = undefined;
    }
  }

  const handler = (req: Request, res: Response, next: NextFunction): void => {
    if (isBackendPath(req.path)) return next();
    if (!requestHandler) {
      res.status(503).set('Cache-Control', 'no-store').type('text/html; charset=utf-8').send(NOT_BUILT);
      return;
    }
    if (isAdminPath(req.path)) {
      const csp = adminCsp(createNonce(), dev);
      // Next reads the nonce from the request's CSP header and stamps it on its inline scripts.
      req.headers['content-security-policy'] = csp;
      res.set({ ...ADMIN_SECURITY_HEADERS, 'Content-Security-Policy': csp });
    } else {
      // A client-chosen CSP must never reach Next, which would read a nonce out of it.
      delete req.headers['content-security-policy'];
    }
    requestHandler(req, res).catch((e: unknown) => {
      logger.error(`Web UI request failed: ${messageOf(e)}`);
      if (!res.headersSent) res.status(500).type('text/plain').send('Internal Server Error');
      else res.end();
    });
  };

  function attachUpgrade(server: http.Server): void {
    server.on('upgrade', (req, socket, head) => {
      const p = (req.url ?? '').split('?')[0];
      if (!upgradeHandler || !p.startsWith('/_next/')) return;
      const handle = upgradeHandler;
      new Promise((resolve) => resolve(handle(req, socket, head)))
        .catch((e: unknown) => {
          logger.error(`Web UI upgrade failed: ${messageOf(e)}`);
          socket.destroy();
        });
    });
  }

  async function close(): Promise<void> {
    if (!app?.close) return;
    try {
      await app.close();
    } catch (e) {
      logger.error(`Web UI failed to close: ${messageOf(e)}`);
    }
  }

  return { prepare, handler, attachUpgrade, close };
}
