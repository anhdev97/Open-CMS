import type { Kysely } from 'kysely';
import type { AssetsModuleOptions } from '@opencms/assets';
import type { AuthFileConfig } from '@opencms/oauth2';
import type { ContentGroupDefinition, ContentTypeDefinition, OpenCmsConfig, ResolvedConfig } from '@opencms/schema';
import type { LoadNext } from './web';

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
  /** `import contentGroups from './content-groups'`. Default: none. */
  contentGroups?: ContentGroupDefinition[];
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
  web?: {
    /** Serve the project's Next app (the admin UI under /admin, the site elsewhere). Default true. */
    enabled?: boolean;
    /** Directory of the Next app. Default `process.cwd()`. */
    dir?: string;
    /** Run Next in dev mode. Default `NODE_ENV !== 'production'`. */
    dev?: boolean;
    /** Undocumented; for tests. */
    loadNext?: LoadNext;
  };
  /** Asset upload + storage. Omit to keep only register-by-URL (no upload, no static serving). */
  assets?: AssetsModuleOptions;
  /** Exact origins allowed to read `/api/content/**` cross-origin (GET, HEAD, OPTIONS; no credentials). */
  cors?: { origins: string[] };
  /** Environment for the auth module. Default `process.env`. */
  env?: NodeJS.ProcessEnv;
}

export interface ResolvedOpenCmsOptions extends Omit<OpenCmsModuleOptions, 'config'> {
  config: ResolvedConfig;
  schemaEditable: boolean;
  autoMigrate: boolean;
  hooks: HookRegistration[];
}
