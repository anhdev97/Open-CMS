# Asset upload & storage providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@opencms/assets` with local/S3/GCS storage providers, Nest multipart upload, SEO-oriented WebP + `srcset` variants, and admin UI warnings for missing `alt`.

**Architecture:** Sync pipeline on upload (slug → sharp WebP/sizes → `StorageProvider.put` → `opencms_assets` row with `variants` JSONB). One active provider via `OpenCmsModuleOptions.assets`. Core imports `AssetsModule.forRoot`; asset HTTP routes leave `SystemController`. Omit `assets` → register-by-URL only (no multipart upload / no disk writes).

**Tech Stack:** NestJS 11, Kysely, PostgreSQL, `sharp`, optional `@aws-sdk/client-s3` / `@google-cloud/storage`, vitest, supertest.

**Spec:** `docs/superpowers/specs/2026-10-23-assets-storage-providers-design.md`

## Global Constraints

- One active provider: `'local' | 's3' | 'gcs'`.
- Multipart proxy through Nest for all providers (no signed URL in v1).
- Image MIME → WebP + optional `thumb`/`medium`/`large` (defaults max edge **320 / 1280 / 1920**); never upscale; skip a size if source max edge ≤ that size.
- Non-image: store as-is; always set `variants.original`.
- Object key: `{yyyy}/{mm}/{slug}-{shortId}[_{variant}].{ext}`.
- `alt` optional; responses include `seo: { missingAlt: boolean }` for images (`mimeType` starts with `image/` and empty/null alt).
- Delete: storage keys first, then DB; storage failure → **502**, keep row.
- Permissions: list `content.read`; upload/register/patch/delete `content.update`.
- `omit assets` config → no `POST …/upload`, no local static mount; GET/POST register/PATCH/DELETE still work for URL registration.
- Default `limits.maxBytes`: **10_485_760** (10 MiB). Default accept: any (caller/field may narrow later).
- Megapixel cap in pipeline: reject images with `width * height > 40_000_000` with 400.
- Error body shape matches existing `/api/**`: Nest exceptions (`BadRequestException`, `PayloadTooLargeException`, `NotFoundException`, `BadGatewayException`).

---

## File structure

```
packages/assets/
  package.json
  tsconfig.json
  src/
    index.ts
    constants.ts                 # ASSETS_OPTIONS, STORAGE_PROVIDER, default sizes/limits
    types.ts                     # AssetVariants, VariantInfo, AssetsModuleOptions
    seo/slug.ts                  # slugifyFilename
    seo/missing-alt.ts           # missingAlt(asset)
    provider/storage-provider.ts # interface
    provider/local.provider.ts
    provider/s3.provider.ts
    provider/gcs.provider.ts
    provider/create-provider.ts  # factory + fail-fast missing peer
    pipeline/image-pipeline.ts   # processUpload(buffer, filename, mime, opts) → ProcessedUpload
    nest/assets.module.ts
    nest/assets.service.ts
    nest/assets.controller.ts
    nest/local-static.middleware.ts  # or Nest static for local.root
  test/
    unit/slug.test.ts
    unit/missing-alt.test.ts
    unit/image-pipeline.test.ts
    unit/local.provider.test.ts
    unit/s3.provider.test.ts
    unit/gcs.provider.test.ts
    integration/assets-api.test.ts

packages/db/src/index.ts         # add 0004_assets_storage migration
packages/core/src/options.ts     # assets?: AssetsModuleOptions fields
packages/core/src/opencms.module.ts
packages/core/src/system.controller.ts  # remove asset routes
packages/core/admin/src/components/FieldInput.tsx  # upload + missingAlt warn
packages/core/admin/src/i18n/messages/*.ts
packages/core/package.json       # dep @opencms/assets
examples/phone-store/…           # optional local assets config (Task 10)
```

---

### Task 1: Scaffold `@opencms/assets`

**Files:**
- Create: `packages/assets/package.json`
- Create: `packages/assets/tsconfig.json`
- Create: `packages/assets/src/index.ts`
- Create: `packages/assets/src/constants.ts`
- Create: `packages/assets/src/types.ts`

**Interfaces:**
- Produces: package name `@opencms/assets`; exports will grow in later tasks.

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@opencms/assets",
  "version": "0.1.0",
  "description": "Asset upload and storage providers for opencms",
  "license": "MIT",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./package.json": "./package.json"
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@opencms/db": "workspace:*",
    "@opencms/schema": "workspace:*",
    "kysely": "^0.28.0",
    "sharp": "^0.34.0"
  },
  "peerDependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "reflect-metadata": "^0.2.0",
    "rxjs": "^7.8.0",
    "@aws-sdk/client-s3": "^3.0.0",
    "@google-cloud/storage": "^7.0.0"
  },
  "peerDependenciesMeta": {
    "@aws-sdk/client-s3": { "optional": true },
    "@google-cloud/storage": { "optional": true }
  },
  "devDependencies": {
    "@nestjs/common": "^11.2.5",
    "@nestjs/core": "^11.2.5",
    "@nestjs/platform-express": "^11.2.5",
    "@nestjs/testing": "^11.2.5",
    "@types/express": "^5.0.6",
    "@types/supertest": "^6.0.3",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.2",
    "supertest": "^7.1.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json** (same pattern as oauth2)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 3: Add types + constants**

`src/types.ts`:

```ts
export type StorageProviderKind = 'local' | 's3' | 'gcs';

export interface VariantInfo {
  url: string;
  width?: number;
  height?: number;
  bytes: number;
  mimeType: string;
}

export interface AssetVariants {
  original: VariantInfo;
  thumb?: VariantInfo;
  medium?: VariantInfo;
  large?: VariantInfo;
}

export interface LocalAssetsConfig {
  root: string;
  publicBaseUrl: string;
}

export interface S3AssetsConfig {
  bucket: string;
  region: string;
  publicBaseUrl?: string;
}

export interface GcsAssetsConfig {
  bucket: string;
  publicBaseUrl?: string;
}

export interface AssetsImageConfig {
  sizes?: { thumb?: number; medium?: number; large?: number };
}

export interface AssetsLimitsConfig {
  maxBytes?: number;
  accept?: string[];
}

export interface AssetsModuleOptions {
  provider: StorageProviderKind;
  local?: LocalAssetsConfig;
  s3?: S3AssetsConfig;
  gcs?: GcsAssetsConfig;
  limits?: AssetsLimitsConfig;
  image?: AssetsImageConfig;
}
```

`src/constants.ts`:

```ts
export const ASSETS_OPTIONS = Symbol('ASSETS_OPTIONS');
export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');
export const DEFAULT_MAX_BYTES = 10_485_760;
export const DEFAULT_IMAGE_SIZES = { thumb: 320, medium: 1280, large: 1920 } as const;
export const MAX_IMAGE_PIXELS = 40_000_000;
```

`src/index.ts`:

```ts
export type * from './types';
export { ASSETS_OPTIONS, STORAGE_PROVIDER, DEFAULT_MAX_BYTES, DEFAULT_IMAGE_SIZES, MAX_IMAGE_PIXELS } from './constants';
```

- [ ] **Step 4: Install workspace deps**

Run: `pnpm install` from repo root  
Expected: `@opencms/assets` linked; `sharp` builds (already in `onlyBuiltDependencies`).

- [ ] **Step 5: Commit**

```bash
git add packages/assets/package.json packages/assets/tsconfig.json packages/assets/src pnpm-lock.yaml
git commit -m "chore(assets): scaffold @opencms/assets package"
```

---

### Task 2: Slug + missingAlt helpers

**Files:**
- Create: `packages/assets/src/seo/slug.ts`
- Create: `packages/assets/src/seo/missing-alt.ts`
- Create: `packages/assets/test/unit/slug.test.ts`
- Create: `packages/assets/test/unit/missing-alt.test.ts`
- Modify: `packages/assets/src/index.ts`

**Interfaces:**
- Produces: `slugifyFilename(originalName: string, extOverride?: string): { slug: string; ext: string }`  
  - `slug`: kebab ASCII, max 80 chars, fallback `file` if empty  
  - `ext`: lowercase without dot; from `extOverride` or original  
- Produces: `missingAlt(asset: { mimeType?: string | null; alt?: string | null }): boolean`  
  - true iff mime is image AND `!(alt?.trim())`

- [ ] **Step 1: Write failing tests**

```ts
// packages/assets/test/unit/slug.test.ts
import { describe, expect, it } from 'vitest';
import { slugifyFilename } from '../../src/seo/slug';

describe('slugifyFilename', () => {
  it('slugifies unicode and keeps extension', () => {
    expect(slugifyFilename('Ảnh Sản Phẩm.JPG')).toEqual({ slug: 'anh-san-pham', ext: 'jpg' });
  });
  it('uses extOverride', () => {
    expect(slugifyFilename('Photo.PNG', 'webp')).toEqual({ slug: 'photo', ext: 'webp' });
  });
  it('falls back when name is symbols only', () => {
    expect(slugifyFilename('!!!').slug).toBe('file');
  });
});
```

```ts
// packages/assets/test/unit/missing-alt.test.ts
import { describe, expect, it } from 'vitest';
import { missingAlt } from '../../src/seo/missing-alt';

describe('missingAlt', () => {
  it('is true for image without alt', () => {
    expect(missingAlt({ mimeType: 'image/webp', alt: null })).toBe(true);
  });
  it('is false for image with alt', () => {
    expect(missingAlt({ mimeType: 'image/png', alt: 'Hero' })).toBe(false);
  });
  it('is false for non-image without alt', () => {
    expect(missingAlt({ mimeType: 'application/pdf', alt: null })).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm exec vitest run packages/assets/test/unit/slug.test.ts packages/assets/test/unit/missing-alt.test.ts`  
Expected: FAIL (module not found / export missing).

- [ ] **Step 3: Implement**

`slug.ts` — use `normalize('NFKD')`, strip combining marks, replace non `[a-z0-9]+` with `-`, trim `-`, slice 80.  
`missing-alt.ts` — as interface above.

Export both from `index.ts`.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/assets/src/seo packages/assets/test/unit packages/assets/src/index.ts
git commit -m "feat(assets): slugify filenames and missingAlt helper"
```

---

### Task 3: `StorageProvider` + local provider

**Files:**
- Create: `packages/assets/src/provider/storage-provider.ts`
- Create: `packages/assets/src/provider/local.provider.ts`
- Create: `packages/assets/test/unit/local.provider.test.ts`
- Modify: `packages/assets/src/index.ts`

**Interfaces:**
- Produces:

```ts
export interface StorageProvider {
  readonly kind: StorageProviderKind;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  publicUrl(key: string): string;
}
```

- `createLocalServerProvider(cfg: LocalAssetsConfig): StorageProvider`  
  - writes under `path.join(root, key)` (mkdir recursive)  
  - `publicUrl` = `publicBaseUrl.replace(/\/$/, '') + '/' + key`  
  - `delete` ignores missing file (no throw)

- [ ] **Step 1: Write failing test** using `fs.mkdtempSync` + put/read/publicUrl/delete

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement interface + local provider**

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(assets): StorageProvider interface and localServerProvider"
```

---

### Task 4: Image / file pipeline

**Files:**
- Create: `packages/assets/src/pipeline/image-pipeline.ts`
- Create: `packages/assets/test/unit/image-pipeline.test.ts`

**Interfaces:**
- Produces:

```ts
export type VariantKind = 'original' | 'thumb' | 'medium' | 'large';

export interface PipelineObject {
  kind: VariantKind;
  key: string;
  body: Buffer;
  contentType: string;
  width?: number;
  height?: number;
}

export interface ProcessedUpload {
  filename: string;       // display name, e.g. anh-san-pham.webp
  mimeType: string;
  storageKey: string;     // key of original (without _variant)
  objects: PipelineObject[];
}

export function processUpload(
  input: { buffer: Buffer; originalFilename: string; mimeType: string },
  opts: {
    now?: Date;
    shortId?: string; // default random 4 hex
    sizes?: { thumb: number; medium: number; large: number };
  },
): Promise<ProcessedUpload>;
```

Rules:
- If `mimeType.startsWith('image/')` (and not `image/svg+xml`): sharp → WebP; build sizes; keys `…/{slug}-{id}.webp` and `…/{slug}-{id}_{thumb|medium|large}.webp`.
- SVG and non-images: single object, keep extension from slugify, contentType unchanged.
- Reject if image pixels > `MAX_IMAGE_PIXELS` → throw Error with code `image_too_large` (service maps to 400).

- [ ] **Step 1: Write failing tests**
  - Tiny PNG fixture (1×1) → only `original` (no thumb/medium/large).
  - Generate ~400px wide PNG via sharp in test → has `thumb`, no `medium`/`large`.
  - PDF buffer → one object, mime `application/pdf`.

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement with sharp**

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(assets): sync image pipeline with WebP variants"
```

---

### Task 5: Migration `0004_assets_storage`

**Files:**
- Modify: `packages/db/src/index.ts` (add migration after `0003_workflow`)
- Modify: `packages/db/test/core-stream-order.test.ts` if it hardcodes migration list

**Interfaces:**
- Produces: columns `storage_key text null`, `provider text null`, `variants jsonb null` on `opencms_assets`.

- [ ] **Step 1: Write/adjust test** expecting `0004_assets_storage` in `allCoreMigrations()` keys after `0003_workflow`.

- [ ] **Step 2: Run db tests — FAIL or assert missing**

- [ ] **Step 3: Add migration**

```ts
'0004_assets_storage': {
  async up(db) {
    await db.schema.alterTable(SYSTEM_TABLES.assets).addColumn('storage_key', 'text').execute();
    await db.schema.alterTable(SYSTEM_TABLES.assets).addColumn('provider', 'text').execute();
    await db.schema.alterTable(SYSTEM_TABLES.assets).addColumn('variants', 'jsonb').execute();
  },
  async down(db) {
    await db.schema.alterTable(SYSTEM_TABLES.assets).dropColumn('variants').execute();
    await db.schema.alterTable(SYSTEM_TABLES.assets).dropColumn('provider').execute();
    await db.schema.alterTable(SYSTEM_TABLES.assets).dropColumn('storage_key').execute();
  },
},
```

- [ ] **Step 4: Run** `pnpm exec vitest run packages/db/test` — PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(db): add storage_key, provider, variants on opencms_assets"
```

---

### Task 6: AssetsService + AssetsController + AssetsModule

**Files:**
- Create: `packages/assets/src/provider/create-provider.ts`
- Create: `packages/assets/src/nest/assets.service.ts`
- Create: `packages/assets/src/nest/assets.controller.ts`
- Create: `packages/assets/src/nest/assets.module.ts`
- Create: `packages/assets/src/nest/local-static.middleware.ts`
- Modify: `packages/assets/src/index.ts` — export `AssetsModule`, types

**Interfaces:**
- Consumes: `StorageProvider`, `processUpload`, `missingAlt`, `SYSTEM_TABLES.assets`, `ASSETS_OPTIONS`
- Produces: `AssetsModule.forRoot({ dbToken, assets?: AssetsModuleOptions | null })`
  - Always registers GET list, POST register, PATCH, DELETE
  - Registers `POST upload` + local static **only if** `assets` is non-null
  - `createProvider(assets)` throws at module init if s3/gcs peer missing or config incomplete

`AssetsService` methods:
- `list(limit: number)`
- `register(body: { filename, url, mimeType?, alt?, width?, height? })` — variants null / provider null
- `upload(file: { buffer, originalname, mimetype, size }, alt?: string)`
- `patch(id, { alt?: string })`
- `delete(id)` — collect keys from `storage_key` + variant URLs→keys OR store keys inside variants metadata

**Variant key tracking:** each `VariantInfo` also needs a storage key for delete. Extend shape:

```ts
export interface VariantInfo {
  key: string;  // ADD — storage object key
  url: string;
  width?: number;
  height?: number;
  bytes: number;
  mimeType: string;
}
```

Update Task 4 types if not already including `key` (pipeline sets `key` on each object; service copies into variants JSON).

Upload flow:
1. Validate size ≤ maxBytes else 413
2. Optional accept list
3. `processUpload` → for each object `provider.put`
4. Insert row; on DB failure after puts, log orphan keys
5. Return `{ data: rowAsApi, seo: { missingAlt } }`

API row mapping: snake_case DB → camelCase (`mimeType`, `storageKey`, `createdAt`, `variants`, …) matching existing admin expectations where possible (`filename`, `url`, `alt`, `width`, `height`).

Controller:
- `@Controller('api/admin')`
- Use `@RequirePermission` from `@opencms/oauth2` (add oauth2 as dependency of assets — **or** keep controllers in core).  
  **Chốt:** `@opencms/assets` depends on `@opencms/oauth2` only for `RequirePermission` decorator (peer or workspace dep), same as core. Add `"@opencms/oauth2": "workspace:*"` dependency.

Multipart: use Nest `FileInterceptor('file')` from `@nestjs/platform-express` — add as peer/devDep like oauth2 tests.

Local static: middleware mapping path prefix from `local.publicBaseUrl` pathname to `local.root` (only when provider is local).

- [ ] **Step 1: Write integration test skeleton** `packages/assets/test/integration/assets-api.test.ts` using existing oauth2/core test DB helpers if portable; otherwise copy minimal pattern from `packages/oauth2/test/support` (TEST_DATABASE_URL, migrate, Nest testing module with mock auth bypass **or** full login). Prefer: unit-test `AssetsService` with in-memory/local provider + real DB first; full HTTP in Task 8.

For this task, **unit-test AssetsService** with local provider + test DB:

```ts
it('uploads png and returns variants.original + seo.missingAlt', async () => { … });
it('delete removes files from disk', async () => { … });
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement module/service/controller/factory**

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(assets): Nest AssetsModule with upload list patch delete"
```

---

### Task 7: S3 + GCS providers

**Files:**
- Create: `packages/assets/src/provider/s3.provider.ts`
- Create: `packages/assets/src/provider/gcs.provider.ts`
- Create: `packages/assets/test/unit/s3.provider.test.ts`
- Create: `packages/assets/test/unit/gcs.provider.test.ts`
- Modify: `packages/assets/src/provider/create-provider.ts`

**Interfaces:**
- `createS3Provider(cfg: S3AssetsConfig): StorageProvider` — dynamic `require('@aws-sdk/client-s3')`; PutObject / DeleteObject; `publicUrl` from `publicBaseUrl` or `https://{bucket}.s3.{region}.amazonaws.com/{key}`
- `createGcsProvider(cfg: GcsAssetsConfig): StorageProvider` — dynamic `require('@google-cloud/storage')`; `publicUrl` from `publicBaseUrl` or `https://storage.googleapis.com/{bucket}/{key}`
- Factory throws clear Error if package resolve fails: `Provider "s3" requires optional peer @aws-sdk/client-s3`

- [ ] **Step 1: Tests with mocked clients** (inject optional client factory for testability)

```ts
export function createS3Provider(cfg: S3AssetsConfig, deps?: { client?: { send(cmd: unknown): Promise<unknown> } }): StorageProvider
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(assets): s3Provider and gcsProvider with optional peers"
```

---

### Task 8: Wire into `@opencms/core`

**Files:**
- Modify: `packages/core/package.json` — dependency `@opencms/assets`
- Modify: `packages/core/src/options.ts` — `assets?: AssetsModuleOptions`
- Modify: `packages/core/src/opencms.module.ts` — import `AssetsModule.forRoot({ dbToken: OPENCMS_DB, assets: input.assets ?? null })`
- Modify: `packages/core/src/system.controller.ts` — remove asset methods only
- Modify: `packages/core/test/integration/permissions.test.ts` — still hits `/api/admin/assets` (register-by-URL must keep working)
- Create/adjust: integration coverage for upload when assets configured (in assets package or core)

- [ ] **Step 1: Update permissions test if response shape adds fields** (still 201 on register)

- [ ] **Step 2: Run core permission tests — may FAIL if routes missing**

- [ ] **Step 3: Wire module; remove SystemController asset routes**

- [ ] **Step 4: `pnpm install && pnpm exec vitest run packages/core/test/integration/permissions.test.ts packages/assets/test`** — PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): wire AssetsModule; move asset routes out of SystemController"
```

---

### Task 9: Admin UI — upload + missing alt warning

**Files:**
- Modify: `packages/core/admin/src/components/FieldInput.tsx`
- Modify: `packages/core/admin/src/i18n/messages/en-US.ts` (and vi-VN, fr-FR, id-ID for the new keys)
- Optionally small helper `packages/core/admin/src/lib/assets.ts`

**Behavior:**
- For `field.kind === 'asset'`: show current select/checkboxes **plus**:
  - file input → `POST /api/admin/assets/upload` as multipart (`file` field); on success invalidate `optionCache` key `assets`, select new id, show warning if `seo.missingAlt`
  - when selected option’s asset has missing alt (fetch list includes alt/mime or store on option), show alert text
  - inline input to PATCH alt then clear warning

i18n keys (en):
- `field.assetMissingAlt`: `This image is missing alt text (helps SEO and accessibility).`
- `field.assetUpload`: `Upload`
- `field.assetAltPlaceholder`: `Alt text`

- [ ] **Step 1: Implement UI + messages** (manual check in browser; no RTL component test required in v1)

- [ ] **Step 2: `pnpm --filter @opencms/core typecheck` admin project — PASS

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(admin): asset upload and missing-alt warning on fields"
```

---

### Task 10: Example + docs

**Files:**
- Modify: `examples/phone-store/src/app.module.ts` — optional:

```ts
assets: {
  provider: 'local',
  local: {
    root: path.join(__dirname, '..', 'uploads'),
    publicBaseUrl: '/media',
  },
},
```

- Add `examples/phone-store/uploads/.gitkeep` + gitignore uploads contents
- Modify: `README.md` roadmap line → note assets providers; short config snippet under a “Assets” heading
- Modify: `CHANGELOG.md` Unreleased section

- [ ] **Step 1: Wire phone-store local assets; document**

- [ ] **Step 2: Smoke typecheck example if applicable**

- [ ] **Step 3: Commit**

```bash
git commit -m "docs: asset storage providers config and phone-store local example"
```

---

## Spec coverage checklist

| Spec item | Task |
|---|---|
| `@opencms/assets` package | 1 |
| Slug + missingAlt | 2 |
| localServerProvider | 3 |
| WebP + thumb/medium/large sync | 4 |
| `storage_key` / `provider` / `variants` migration | 5 |
| Upload/list/patch/delete + register-by-URL + local serve | 6 |
| s3Provider / gcsProvider + optional peers | 7 |
| Core wire; SystemController cleanup; permissions | 8 |
| Admin warn on attach + upload | 9 |
| Example + README | 10 |
| Omit assets = no upload | 6 + 8 |
| Delete storage-then-DB / 502 | 6 |
| D8 permissions | 6 + 8 |

## Plan self-review notes

- `VariantInfo.key` added so delete does not reverse-engineer URLs — update pipeline + DB JSON accordingly (Tasks 4 & 6).
- `@opencms/assets` → `@opencms/oauth2` for `@RequirePermission` only; no reverse dependency.
- No async queue / sitemap / AVIF (out of scope).
