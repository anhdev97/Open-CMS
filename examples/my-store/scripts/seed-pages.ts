// Dev seed for the page builder: publishes `/` (the storefront of docs/superpowers/specs/assets/2026-11-24-store-preview.html,
// built from the Block Builder blocks StoreHeader, StoreHero, SectionHead (holding FeaturedProducts: the three oldest
// products), StoryBand, StoreFooter; English, plus its vi-VN translation), `/shop` (the Block Builder examples: ProductCard
// for one product, ActiveProducts for the products with active = true) and `/about`.
// Without any product yet it first publishes three sample products (two on sale, one not), each with a photo uploaded to
// the media library (scripts/seed-assets/*.webp, crops of public/files/store-editorial.webp). With --force, sample
// products (by slug) that have no image yet get theirs too.
// Run after `opencloudcms migrate:up`:  pnpm seed:pages
// A page that already exists at one of these paths (in the default locale) is left untouched, unless --force
// (`pnpm seed:pages -- --force`): then its content, title and SEO are replaced and it is published again.
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { BlockDefinition } from '@opencloudcms/core/blocks';

const root = path.resolve(__dirname, '..');
const force = process.argv.includes('--force');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

async function main() {
  // Imported after .env is loaded: opencloudcms.config.ts reads DATABASE_URL.
  const { EntriesService, OpenCloudCmsModule } = await import('@opencloudcms/core');
  const { AssetsService } = await import('@opencloudcms/assets');
  const { blockManifest, writePageContent } = await import('@opencloudcms/core/blocks');
  const { PAGE_API_ID } = await import('@opencloudcms/schema');
  const { default: config } = await import('../opencloudcms.config');
  const { default: blocks } = await import('../src/blocks');
  const { contentTypes } = await import('../src/generated');

  @Module({
    imports: [
      OpenCloudCmsModule.forRoot({
        root,
        config,
        contentTypes,
        web: { enabled: false },
        schemaEditable: false,
        pages: { blocks: blockManifest(blocks) },
        // Same media storage as src/app.module.ts, so seeded photos are served at /media.
        assets: { provider: 'local', local: { root: path.join(root, 'assets'), publicBaseUrl: '/media' } },
      }),
    ],
  })
  class SeedModule {}

  const app = await NestFactory.createApplicationContext(SeedModule, { logger: ['error'] });
  try {
    const entries = app.get(EntriesService);
    const locale = config.defaultLocale ?? 'en-US';

    /** A Puck item with every field at its default, then `props`. */
    let n = 0;
    const item = (type: string, props: Record<string, unknown> = {}) => {
      const def = blocks.list.find((d: BlockDefinition<any>) => d.name === type);
      if (!def) throw new Error(`Block ${type} is not registered in src/blocks/index.ts`);
      const defaults = Object.fromEntries(
        Object.entries(def.fields as Record<string, { kind: string; default?: unknown }>)
          .map(([k, f]) => [k, 'default' in f ? f.default : f.kind === 'list' ? [] : undefined])
          .filter(([, v]) => v !== undefined),
      );
      return { type, props: { id: `${type}-seed-${++n}`, ...defaults, ...props } };
    };
    const content = (...items: ReturnType<typeof item>[]) => writePageContent({ root: { props: {} }, content: items } as never, blocks);

    const admin = { id: undefined as unknown as string, permissions: ['content.update', 'content.publish'] as never[] };

    // Product photos: uploaded once to the media library (found again by filename on later runs).
    const assets = app.get(AssetsService);
    const photo = async (file: string, alt: string): Promise<string> => {
      const known = (await assets.list(500)).data.find((a) => a.filename === file);
      if (known) return known.id;
      const buffer = fs.readFileSync(path.join(root, 'scripts/seed-assets', file));
      const { data } = await assets.upload({ buffer, originalname: file, mimetype: 'image/webp', size: buffer.length }, { alt });
      console.log(`uploaded ${file} (${data.id})`);
      return data.id;
    };

    // Sample products, only into an empty catalogue. New products are on sale (active: true) unless said otherwise.
    const samples = [
      { name: 'Linen shirt', slug: 'linen-shirt', price: { amount: 390000, currency: 'VND' }, active: true, featured: true,
        photo: ['store-shirt.webp', 'Olive linen shirt on a hanger'] },
      { name: 'Canvas tote', slug: 'canvas-tote', price: { amount: 150000, currency: 'VND' }, active: true,
        photo: ['store-tote.webp', 'Natural canvas tote bag on a wooden bench'] },
      { name: 'Wool scarf (last season)', slug: 'wool-scarf', price: { amount: 250000, currency: 'VND' }, active: false,
        photo: ['store-scarf.webp', 'Brick-red scarf folded on a wooden bench'] },
    ];
    const anyProduct = await entries.list('product', { status: 'draft', limit: 1 });
    if (anyProduct.data.length === 0) {
      for (const { photo: [file, alt], ...p } of samples) {
        const { data: created } = await entries.create('product', { ...p, images: [await photo(file, alt)] }, locale);
        await entries.publish('product', created.documentId, admin);
        console.log(`published product ${p.slug} (${created.documentId}, active: ${p.active})`);
      }
    } else if (force) {
      // Sample products of an earlier seed (by slug) without a photo get theirs.
      for (const { slug, photo: [file, alt] } of samples) {
        const found = (await entries.list('product', { status: 'draft', locale, filter: { slug }, limit: 1 })).data[0];
        if (!found || (Array.isArray(found.images) && found.images.length)) continue;
        await entries.update('product', found.documentId as string, { images: [await photo(file, alt)] }, locale);
        await entries.publish('product', found.documentId as string, admin);
        console.log(`added photo to product ${slug} (${found.documentId})`);
      }
    }
    const onSale = await entries.list('product', { status: 'published', locale, filter: { active: 'true' }, sort: 'createdAt:asc', limit: 1 });
    const pick = onSale.data[0]?.documentId;

    const pages = [
      {
        title: 'Home',
        path: '/',
        seo: { title: 'my-store', description: 'Clothing and accessories for every day.' },
        // Copy = the blocks' field defaults (English); the vi-VN translation below uses the mockup's Vietnamese copy.
        content: content(
          item('StoreHeader'),
          item('StoreHero'),
          item('SectionHead', { slot: [item('FeaturedProducts')] }),
          item('StoryBand'),
          item('StoreFooter'),
        ),
        translations: {
          'vi-VN': {
            title: 'Trang chủ',
            seo: { title: 'my-store', description: 'Quần áo và phụ kiện cho mỗi ngày.' },
            content: content(
              item('StoreHeader', { nav1Label: 'Trang chủ', nav2Label: 'Cửa hàng', nav3Label: 'Giới thiệu' }),
              item('StoreHero', {
                heading: 'Mặc đẹp mỗi ngày',
                intro: 'Áo linen thoáng nhẹ, túi canvas chắc tay và những món đồ đơn giản để dùng lâu.',
                ctaLabel: 'Xem bộ sưu tập →',
                image: { src: '/files/store-editorial.webp', alt: 'Áo linen ô liu, túi canvas và khăn màu đất trên ghế gỗ' },
              }),
              item('SectionHead', { heading: 'Sản phẩm nổi bật', linkLabel: 'Xem tất cả →', slot: [item('FeaturedProducts')] }),
              item('StoryBand', {
                heading: 'Về my-store',
                body: 'Chúng mình chọn những chất liệu dễ chăm sóc và kiểu dáng dễ phối để mỗi món bạn mua đều có chỗ trong tủ đồ.',
                linkLabel: 'Đọc câu chuyện của cửa hàng →',
              }),
              item('StoreFooter', {
                tagline: 'Quần áo và phụ kiện cho mỗi ngày.',
                exploreTitle: 'Khám phá',
                link1Label: 'Cửa hàng',
                link2Label: 'Giới thiệu',
                contactTitle: 'Liên hệ',
              }),
            ),
          },
        },
      },
      {
        title: 'Shop',
        path: '/shop',
        seo: { title: 'Shop - my-store' },
        content: content(
          item('Heading', { text: 'Shop', level: 1 }),
          // Composed blocks (src/blocks/product-card, src/blocks/active-products), made with the Block Builder.
          ...(pick ? [item('ProductCard', { badge: 'Staff pick', entry: { documentId: pick } })] : []),
          item('Heading', { text: 'On sale', level: 2 }),
          item('ActiveProducts'),
        ),
      },
      {
        title: 'About',
        path: '/about',
        seo: { title: 'About my-store' },
        content: content(
          item('Heading', { text: 'About my-store', level: 1 }),
          item('Text', { content: '<p>my-store is the example project of OpenCloudCMS. Edit this page in the admin under Pages.</p>' }),
        ),
      },
    ];

    const locales: string[] = config.locales ?? [locale];
    for (const { translations, ...p } of pages as (Omit<(typeof pages)[number], 'translations'> & {
      translations?: Record<string, { title: string; seo: Record<string, string>; content: unknown }>;
    })[]) {
      const existing = await entries.list(PAGE_API_ID, { status: 'draft', locale, filter: { path: p.path }, limit: 1 });
      const found = existing.data.find((d) => d.locale === locale);
      let documentId: string;
      if (!found) {
        documentId = (await entries.create(PAGE_API_ID, p, locale)).data.documentId as string;
      } else if (force) {
        documentId = found.documentId as string;
        await entries.update(PAGE_API_ID, documentId, p, locale);
      } else {
        console.log(`skip ${p.path}: a page already exists there (--force replaces it)`);
        continue;
      }
      // Translations of the same page (same documentId), only for locales the project enables.
      const done: string[] = [];
      for (const [loc, t] of Object.entries(translations ?? {})) {
        if (!locales.includes(loc)) continue;
        await entries.update(PAGE_API_ID, documentId, { ...t, path: p.path }, loc);
        done.push(loc);
      }
      await entries.publish(PAGE_API_ID, documentId, admin);
      console.log(`${found ? 'replaced' : 'published'} ${p.path} (${documentId}${done.length ? `, + ${done.join(', ')}` : ''})`);
    }
  } finally {
    await app.close();
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
