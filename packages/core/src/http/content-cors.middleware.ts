import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { OPENCLOUDCMS_OPTIONS, type ResolvedOpenCloudCmsOptions } from '../options';
import { ContentRegistry } from '../registry.service';

/** `/api/content/<segment>` routes that are not content types (`@opencloudcms/assets`' public asset lookup). */
const NON_TYPE_SEGMENTS: ReadonlySet<string> = new Set(['assets']);

/** First path segment after `/api/content/`, decoded; null when there is none or it is malformed. */
function contentSegment(url: string): string | null {
  const m = /^\/api\/content\/([^/?#]+)/i.exec(url);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return null;
  }
}

/**
 * CORS for the public delivery API only: exact origins from `cors.origins`, read-only methods, no credentials.
 * Only routes the public API serves get CORS headers and a 204 preflight: for an unknown or private apiId the
 * preflight answers the same 404 as a GET (and no CORS headers), so a private type cannot be told from a missing one.
 */
@Injectable()
export class ContentCorsMiddleware implements NestMiddleware {
  private readonly origins: ReadonlySet<string>;

  constructor(
    @Inject(OPENCLOUDCMS_OPTIONS) options: ResolvedOpenCloudCmsOptions,
    @Inject(ContentRegistry) private readonly registry: ContentRegistry,
  ) {
    this.origins = new Set(options.cors?.origins ?? []);
  }

  use(req: Request, res: Response, next: NextFunction): void {
    const origin = req.headers.origin;
    // The response depends on Origin whenever CORS is configured, so shared caches must key on it.
    if (this.origins.size > 0) res.vary('Origin');
    const segment = contentSegment(req.originalUrl ?? req.url);
    const served = segment !== null && (NON_TYPE_SEGMENTS.has(segment) || this.registry.isPublic(segment));
    if (!served) {
      if (req.method === 'OPTIONS') {
        // Same body as `ContentRegistry.get` for an unknown apiId, rendered as the API error filter does.
        res.status(404).json({ error: { code: 'not_found', message: `Unknown content type "${segment ?? ''}"` } });
        return;
      }
      next();
      return;
    }
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
