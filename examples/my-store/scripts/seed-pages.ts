// Dev seed for the page builder. First the base page "Store" (made the default base page): the StoreFrame layout
// block with StoreHeader, the MobileMenu drawer (`menu-mobile`) and the ContactModal (`lien-he`) in its `header`
// region and StoreFooter in its `footer` region. Then the pages, which sit in that frame: `/` (the storefront of
// docs/superpowers/specs/assets/2026-11-24-store-preview.html, built from the Block Builder blocks StoreHero,
// SectionHead (holding FeaturedProducts: the three oldest products) and StoryBand; English, plus its vi-VN
// translation), `/shop` (the Block Builder examples: ProductCard for one product, ActiveProducts for the products with
// active = true), `/about`, and `/landing`, which replaces the base's header with a simple one (and its own contact
// popup) and hides the footer.
// Builder components (spec 2026-11-26): the header has a two-level "Shop" menu (Dropdown) whose links go to the
// category pages `/shop/ao`, `/shop/quan`, `/shop/phu-kien`; the home page adds a banner carousel (HomeBanner) and an
// FAQ (Faq); every published product gets a page `/products/<slug>` (ProductTabs: tabs and a tooltip on a badge, then
// ProductStrip: clickable product cards in a carousel, linking to these pages). Placeholder copy only.
// Without any product yet it first publishes three sample products (two on sale, one not), each with a photo uploaded to
// the media library (scripts/seed-assets/*.webp, crops of public/files/store-editorial.webp). With --force, sample
// products (by slug) that have no image yet get theirs too.
// Run after `opencloudcms migrate:up`:  pnpm seed:pages
// A page that already exists at one of these paths (in the default locale), or a base page titled "Store", is left
// untouched, unless --force (`pnpm seed:pages -- --force`): then its content, title, SEO and layout are replaced, it
// is published again, and "Store" becomes the default base page again.
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
  const { EntriesService, OpenCloudCmsModule, PagesService } = await import('@opencloudcms/core');
  const { AssetsService } = await import('@opencloudcms/assets');
  const { blockManifest, writePageContent } = await import('@opencloudcms/core/blocks');
  const { collectBlockNames, PAGE_API_ID } = await import('@opencloudcms/schema');
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
    type Item = ReturnType<typeof item>;
    const content = (...items: Item[]) => writePageContent({ root: { props: {} }, content: items } as never, blocks);
    /** Page content with replacement blocks for base page regions (root props `region__<name>`). */
    const contentWithRegions = (regions: Record<string, Item[]>, ...items: Item[]) =>
      writePageContent({ root: { props: Object.fromEntries(Object.entries(regions).map(([k, v]) => [`region__${k}`, v])) }, content: items } as never, blocks);

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

    // The base page "Store": the frame every page below sits in (none sets `layout.baseId`, so the default base).
    const pagesService = app.get(PagesService);
    type Nav = { nav: [string, string, string]; shop: [string, string, string]; contact: string; menu: string };
    /** Labels of the two-level menu, the same in the header and in the drawer (links: the block defaults). */
    const navLabels = (h: Nav) => ({
      nav1Label: h.nav[0], nav2Label: h.nav[1], nav3Label: h.nav[2], shop1Label: h.shop[0], shop2Label: h.shop[1], shop3Label: h.shop[2],
    });
    const frame = (header: Nav, modal: Record<string, unknown>, menu: string, footer: Record<string, unknown>) =>
      content(
        item('StoreFrame', {
          region__header: [
            item('StoreHeader', { ...navLabels(header), contactLabel: header.contact, menuLabel: header.menu }),
            // Overlays take no space: the ☰ button toggles the drawer, the Contact buttons open the popup.
            item('MobileMenu', { name: 'menu-mobile', title: menu, ...navLabels(header) }),
            item('ContactModal', { name: 'lien-he', ...modal }),
          ],
          pageContent: [],
          region__footer: [item('StoreFooter', footer)],
        }),
      );
    const viModal = {
      heading: 'Liên hệ với chúng mình',
      body: 'Có câu hỏi về đơn hàng, kích cỡ hay đổi trả? Hãy viết hoặc gọi cho chúng mình, chúng mình trả lời trong một ngày.',
      phone: '028 1234 5678',
      closeLabel: 'Đóng',
      // The contact form layout (UI only: it does not send yet).
      nameLabel: 'Họ tên',
      emailLabel: 'Email',
      phoneLabel: 'Số điện thoại',
      topicLabel: 'Chủ đề',
      topicPlaceholder: 'Chọn chủ đề',
      messageLabel: 'Lời nhắn',
      messagePlaceholder: 'Chúng mình có thể giúp gì?',
      newsletterLabel: 'Gửi bản tin cho tôi',
      sendLabel: 'Gửi',
    };
    const base = {
      kind: 'base',
      title: 'Store',
      content: frame({ nav: ['Home', 'Shop', 'About'], shop: ['Tops', 'Trousers', 'Accessories'], contact: 'Contact', menu: '☰ Menu' }, {}, 'Menu', {}),
      translations: {
        'vi-VN': {
          title: 'Cửa hàng',
          content: frame(
            { nav: ['Trang chủ', 'Cửa hàng', 'Giới thiệu'], shop: ['Áo', 'Quần', 'Phụ kiện'], contact: 'Liên hệ', menu: '☰ Danh mục' },
            viModal,
            'Danh mục',
            {
              tagline: 'Quần áo và phụ kiện cho mỗi ngày.',
              exploreTitle: 'Khám phá',
              link1Label: 'Cửa hàng',
              link2Label: 'Giới thiệu',
              contactTitle: 'Liên hệ',
              contactLinkLabel: 'Viết cho chúng mình',
            },
          ),
        },
      },
    };
    const locales: string[] = config.locales ?? [locale];
    {
      const { translations, ...b } = base;
      const found = (await pagesService.bases('draft')).data.find((d) => d.title === b.title);
      let baseId = found?.documentId as string | undefined;
      if (!baseId) {
        baseId = (await entries.create(PAGE_API_ID, b, locale)).data.documentId as string;
      } else if (force) {
        await entries.update(PAGE_API_ID, baseId, { title: b.title, content: b.content }, locale);
      }
      if (!found || force) {
        const done: string[] = [];
        for (const [loc, t] of Object.entries(translations)) {
          if (!locales.includes(loc)) continue;
          await entries.update(PAGE_API_ID, baseId, t, loc);
          done.push(loc);
        }
        await entries.publish(PAGE_API_ID, baseId, admin);
        console.log(`${found ? 'replaced' : 'published'} base page Store (${baseId}${done.length ? `, + ${done.join(', ')}` : ''})`);
      } else {
        console.log('skip base page Store: it already exists (--force replaces it)');
      }
      const current = await pagesService.defaultBase('published');
      if (!current || force) {
        if (current !== baseId) await pagesService.setDefault(baseId);
        console.log(`default base page: Store (${baseId})`);
      }
    }

    // Vietnamese placeholder copy of the builder-component blocks (the English copy is their field defaults).
    const viBanner = {
      slide1Heading: 'Linen mùa mới',
      slide1Text: 'Áo linen giặt mềm, nhẹ và thoáng cho những ngày nắng.',
      slide1CtaLabel: 'Xem áo',
      slide2Heading: 'Túi tote cho mỗi ngày',
      slide2Text: 'Túi canvas chắc tay, vừa laptop và cả giỏ đi chợ.',
      slide2CtaLabel: 'Xem phụ kiện',
      slide3Heading: 'Miễn phí giao hàng từ 500.000 ₫',
      slide3Text: 'Đơn từ 500.000 ₫ được giao miễn phí trên toàn Việt Nam.',
      slide3CtaLabel: 'Xem bộ sưu tập',
    };
    const viFaq = {
      heading: 'Câu hỏi thường gặp',
      q1: 'Bao lâu thì nhận được hàng?',
      a1: 'Tại TP. Hồ Chí Minh và Hà Nội hàng đến trong 1 đến 2 ngày, các tỉnh khác trong 3 đến 5 ngày làm việc.',
      q2: 'Tôi có thể đổi hoặc trả hàng không?',
      a2: 'Có. Sản phẩm chưa mặc, còn nhãn có thể đổi hoặc trả trong vòng 30 ngày kể từ khi nhận.',
      q3: 'Làm sao chọn đúng kích cỡ?',
      a3: 'Mỗi trang sản phẩm có bảng số đo trong thẻ Thông số. Nếu phân vân giữa hai cỡ, hãy chọn cỡ lớn hơn với đồ linen.',
      q4: 'Giặt và bảo quản đồ linen thế nào?',
      a4: 'Giặt ở 30 °C, phơi trong bóng râm và ủi khi vải còn hơi ẩm.',
    };
    const viTabs = {
      badge: 'Miễn phí giao hàng',
      badgeTip: 'Miễn phí giao hàng toàn Việt Nam cho đơn từ 500.000 ₫.',
      descriptionTab: 'Mô tả',
      descriptionFallback: 'Một món đồ đơn giản để mặc mỗi ngày. Mô tả đầy đủ sẽ sớm có.',
      specsTab: 'Thông số',
      specs: 'Chất liệu: 100% linen giặt mềm. Dáng: rộng thoải mái. Cỡ: S đến XL. Giặt máy ở 30 °C.',
      shippingTab: 'Giao hàng',
      shipping: 'Giao trong 1 đến 5 ngày làm việc. Đổi trả miễn phí trong 30 ngày.',
    };

    // Category pages behind the header's Shop menu (placeholder: every one lists the products on sale).
    const categories: [string, string, string, string][] = [
      ['/shop/ao', 'Tops', 'Áo', 'Shirts and tops in linen and cotton.'],
      ['/shop/quan', 'Trousers', 'Quần', 'Relaxed trousers and shorts for warm days.'],
      ['/shop/phu-kien', 'Accessories', 'Phụ kiện', 'Totes, scarves and small things to carry.'],
    ];
    const viCategoryIntro: Record<string, string> = {
      '/shop/ao': 'Áo sơ mi và áo thun bằng linen và cotton.',
      '/shop/quan': 'Quần dài và quần short thoải mái cho ngày nắng.',
      '/shop/phu-kien': 'Túi tote, khăn và những món nhỏ mang theo mỗi ngày.',
    };
    const categoryPages = categories.map(([path, title, viTitle, intro]) => ({
      title,
      path,
      seo: { title: `${title} - my-store` },
      content: content(
        item('Heading', { text: title, level: 1 }),
        item('Text', { content: `<p>${intro}</p>` }),
        item('ProductStrip'),
      ),
      translations: {
        'vi-VN': {
          title: viTitle,
          seo: { title: `${viTitle} - my-store` },
          content: content(
            item('Heading', { text: viTitle, level: 1 }),
            item('Text', { content: `<p>${viCategoryIntro[path]}</p>` }),
            item('ProductStrip'),
          ),
        },
      },
    }));

    // A page per published product at /products/<slug> (the ProductStrip cards link there: its urlPattern).
    const published = await entries.list('product', { status: 'published', locale, sort: 'createdAt:asc', limit: 50 });
    const productPages = published.data
      .filter((p) => typeof p.slug === 'string' && /^[a-z0-9-]+$/.test(p.slug))
      .map((p) => ({
        title: String(p.name ?? p.slug),
        path: `/products/${p.slug as string}`,
        seo: { title: `${String(p.name ?? p.slug)} - my-store` },
        content: content(
          item('ProductTabs', { entry: { documentId: p.documentId } }),
          item('SectionHead', { heading: 'You may also like', linkLabel: 'All products →', slot: [item('ProductStrip')] }),
        ),
        translations: {
          'vi-VN': {
            title: String(p.name ?? p.slug),
            seo: { title: `${String(p.name ?? p.slug)} - my-store` },
            content: content(
              item('ProductTabs', { entry: { documentId: p.documentId }, ...viTabs }),
              item('SectionHead', { heading: 'Có thể bạn cũng thích', linkLabel: 'Tất cả sản phẩm →', slot: [item('ProductStrip')] }),
            ),
          },
        },
      }));

    const pages = [
      {
        title: 'Home',
        path: '/',
        seo: { title: 'my-store', description: 'Clothing and accessories for every day.' },
        // Copy = the blocks' field defaults (English); the vi-VN translation below uses the mockup's Vietnamese copy.
        // StoreHeader and StoreFooter come from the base page "Store".
        content: content(item('StoreHero'), item('SectionHead', { slot: [item('FeaturedProducts')] }), item('HomeBanner'), item('StoryBand'), item('Faq')),
        translations: {
          'vi-VN': {
            title: 'Trang chủ',
            seo: { title: 'my-store', description: 'Quần áo và phụ kiện cho mỗi ngày.' },
            content: content(
              item('StoreHero', {
                heading: 'Mặc đẹp mỗi ngày',
                intro: 'Áo linen thoáng nhẹ, túi canvas chắc tay và những món đồ đơn giản để dùng lâu.',
                ctaLabel: 'Xem bộ sưu tập →',
                image: { src: '/files/store-editorial.webp', alt: 'Áo linen ô liu, túi canvas và khăn màu đất trên ghế gỗ' },
              }),
              item('SectionHead', { heading: 'Sản phẩm nổi bật', linkLabel: 'Xem tất cả →', slot: [item('FeaturedProducts')] }),
              item('HomeBanner', viBanner),
              item('StoryBand', {
                heading: 'Về my-store',
                body: 'Chúng mình chọn những chất liệu dễ chăm sóc và kiểu dáng dễ phối để mỗi món bạn mua đều có chỗ trong tủ đồ.',
                linkLabel: 'Đọc câu chuyện của cửa hàng →',
              }),
              item('Faq', viFaq),
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
          // Clickable product cards in a carousel (a collection with layout kind carousel), linking to /products/<slug>.
          item('Heading', { text: 'Browse', level: 2 }),
          item('ProductStrip'),
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
      {
        title: 'Landing',
        path: '/landing',
        seo: { title: 'Summer linen - my-store' },
        // Default base page, its header replaced by this page's `region__header` blocks, its footer hidden.
        layout: { regions: { header: 'replace', footer: 'hide' } },
        content: contentWithRegions(
          {
            header: [
              item('Section', {
                paddingY: '4',
                children: [
                  item('ButtonGroup', {
                    align: 'left',
                    buttons: [
                      { label: 'my-store', link: { kind: 'url', href: '/' }, variant: 'ghost' },
                      { label: 'Contact us', link: null, variant: 'outline', action: { type: 'overlay', op: 'open', target: 'lien-he' } },
                    ],
                  }),
                ],
              }),
              // The base's popup lives in the replaced header region, so this page brings its own.
              item('ContactModal', { name: 'lien-he' }),
            ],
          },
          item('Hero', {
            badge: 'New season',
            heading: 'Summer linen, light on the skin',
            subheading: 'Shirts and totes in washed linen and canvas, made to be worn every day.',
            primaryLabel: 'Shop the collection',
            primaryLink: { kind: 'url', href: '/shop' },
            secondaryLabel: '',
          }),
          item('CallToAction', { heading: 'Questions before you buy?', description: 'Use the Contact us button at the top of the page.', buttonLabel: '' }),
        ),
      },
    ];

    for (const { translations, ...page } of [...pages, ...categoryPages, ...productPages] as (Omit<(typeof pages)[number], 'translations' | 'layout'> & {
      layout?: Record<string, unknown>;
      translations?: Record<string, { title: string; seo: Record<string, string>; content: unknown }>;
    })[]) {
      // No layout: the default base page with every region as is (also resets a layout set earlier, with --force).
      const p = { ...page, layout: page.layout ?? null };
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
        // Pages seeded before the Store base page carry their own header / footer: with the frame they show twice.
        const own = [...collectBlockNames(found.content as Parameters<typeof collectBlockNames>[0]).keys()].filter((n) => n === 'StoreHeader' || n === 'StoreFooter');
        if (own.length) {
          console.log(`  hint: ${p.path} still contains ${own.join(' and ')}, which the Store base page now provides; rerun with --force (\`pnpm seed:pages -- --force\`) to replace it`);
        }
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
