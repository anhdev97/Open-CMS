import { Injectable, type NestMiddleware } from '@nestjs/common';
import express, { type NextFunction, type Request, type Response } from 'express';

const json = express.json({ limit: '1mb' });
const urlencoded = express.urlencoded({ extended: false, limit: '1mb' });

const INTERACTION_PREFIX = '/oauth2/interaction/';

/** oidc-provider's own endpoints. The interaction routes are Nest controllers in @opencms/oauth2 and need the body. */
const isProviderPath = (rawPath: string): boolean => {
  const path = rawPath.toLowerCase(); // Express routing is case-insensitive
  return (path === '/oauth2' || path.startsWith('/oauth2/')) && !path.startsWith(INTERACTION_PREFIX);
};

/**
 * Nest mounts module middleware as an Express route, so `req.route` is set when a parser fails. The API
 * exception filter tells "request rejected before any route matched" (malformed JSON → 422) by an unset
 * `req.route`; the parser rejected the request before a handler ran, so say so.
 */
function failed(req: Request, next: NextFunction, err: unknown): void {
  delete (req as { route?: unknown }).route;
  next(err);
}

/**
 * Core's body parser for everything except oidc-provider's `/oauth2/**` endpoints: oidc-provider reads its own request bodies and
 * warns when a parser got there first. Hosts create the app with `bodyParser: false`. A body already set
 * by a host parser is left alone. Parser failures go to `next(err)` so the API exception filter shapes them.
 */
@Injectable()
export class JsonBodyParserMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    if (req.body !== undefined || isProviderPath(req.path)) return next();
    json(req, res, (err?: unknown) => {
      if (err) return failed(req, next, err);
      urlencoded(req, res, (err2?: unknown) => (err2 ? failed(req, next, err2) : next()));
    });
  }
}
