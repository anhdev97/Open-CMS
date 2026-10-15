import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { OPENCMS_OPTIONS, type ResolvedOpenCmsOptions } from '../options';

/** CORS for the public delivery API only: exact origins from `cors.origins`, read-only methods, no credentials. */
@Injectable()
export class ContentCorsMiddleware implements NestMiddleware {
  private readonly origins: ReadonlySet<string>;

  constructor(@Inject(OPENCMS_OPTIONS) options: ResolvedOpenCmsOptions) {
    this.origins = new Set(options.cors?.origins ?? []);
  }

  use(req: Request, res: Response, next: NextFunction): void {
    const origin = req.headers.origin;
    // The response depends on Origin whenever CORS is configured, so shared caches must key on it.
    if (this.origins.size > 0) res.vary('Origin');
    if (origin && this.origins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  }
}
