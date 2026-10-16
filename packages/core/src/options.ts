import type { Kysely } from 'kysely';
import type { AuthFileConfig } from '@opencms/oauth2';
import type { ContentTypeDefinition, OpenCmsConfig, ResolvedConfig } from '@opencms/schema';
import type { StorefrontModuleOptions } from './storefront/resolve-storefront';

export const OPENCMS_OPTIONS = Symbol('OPENCMS_OPTIONS');
export const OPENCMS_DB = Symbol('OPENCMS_DB');
/** Provides a `CoreReady` holder that OpenCmsModule settles once the database is known to be migrated. */
export const CORE_READY_CORE = Symbol('CORE_READY_CORE');

export interface HookContext {
  apiId: string;
  locale: string;
  db: Kysely<any>;
}

export interface EntryHooks {
  /** May return modified data. Throw to reject. */
  beforeCreate?(data: Record<string, unknown>, ctx: HookContext): unknown;
  beforeUpdate?(data: Record<string, unknown>, ctx: HookContext & { documentId: string }): unknown;
  /** Throw to block publishing (e.g. business validation). */
  beforePublish?(document: PublishedDocument, ctx: HookContext): unknown;
  afterPublish?(document: PublishedDocument, ctx: HookContext): unknown;
  afterUnpublish?(documentId: string, ctx: HookContext): unknown;
  afterDelete?(documentId: string, ctx: HookContext): unknown;
}

export interface PublishedDocument {
  documentId: string;
  /** Shared (non-localizable) field values. */
  shared: Record<string, unknown>;
  /** Localizable field values per locale. */
  translations: Record<string, Record<string, unknown>>;
}

export interface HookRegistration {
  apiId: string;
  hooks: EntryHooks;
}

/** Used in `src/extensions/<type>/<type>.hooks.ts`. */
export function defineHooks(apiId: string, hooks: EntryHooks): HookRegistration {
  return { apiId, hooks };
}

export interface OpenCmsModuleOptions {
  /** Project root (where opencms.config.ts lives). */
  root: string;
  config: OpenCmsConfig;
  /** The generated registry: `import { contentTypes } from './generated'`. */
  contentTypes: ContentTypeDefinition[];
  hooks?: HookRegistration[];
  /**
   * Enables the Content Type Builder API (writes schema files, generates
   * migrations and applies them). Keep it off in production. Default: NODE_ENV !== 'production'.
   */
  schemaEditable?: boolean;
  /** Apply pending migrations on startup instead of refusing to start. Default false. */
  autoMigrate?: boolean;
  /** Non-secret `auth` section (see @opencms/oauth2). Secrets come from the environment. */
  auth?: Partial<AuthFileConfig>;
  admin?: {
    /** Serve the embedded admin UI at /admin. Default true. */
    enabled?: boolean;
    /** Directory with the built admin UI. Undocumented; for tests. */
    distDir?: string;
  };
  /** Exact origins allowed to read `/api/content/**` cross-origin (GET, HEAD, OPTIONS; no credentials). */
  cors?: { origins: string[] };
  /** Environment for the auth module. Default `process.env`. */
  env?: NodeJS.ProcessEnv;
  /**
   * Nest → Next.js storefront reverse-proxy. When enabled, non-excluded paths are
   * forwarded to `targetUrl` (real `next dev` / `next start`). Default enabled=true.
   */
  storefront?: StorefrontModuleOptions;
}

export interface ResolvedOpenCmsOptions extends Omit<OpenCmsModuleOptions, 'config'> {
  config: ResolvedConfig;
  schemaEditable: boolean;
  autoMigrate: boolean;
  hooks: HookRegistration[];
}
