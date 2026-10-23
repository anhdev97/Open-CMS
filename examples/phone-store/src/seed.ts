import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { EntriesService } from '@opencms/core';
import { findProjectRoot } from './root';

const UA = 'OpenCMS-phone-store-example/0.1 (local demo; temporary catalog images)';
const publisher = {
  id: '00000000-0000-4000-8000-0000000000a1',
  permissions: ['content.publish'],
} as Parameters<EntriesService['publish']>[2];

type Body = Record<string, unknown>;

interface PhoneSeed {
  slug: string;
  brand: string;
  category: string;
  price: number;
  featured: boolean;
  storageGb: number;
  ramGb: number;
  screen: string;
  file: string;
  vi: { name: string; description: string; color: string };
  en: { name: string; description: string; color: string };
}

const brands = [
  { slug: 'apple', name: 'Apple' },
  { slug: 'samsung', name: 'Samsung' },
  { slug: 'xiaomi', name: 'Xiaomi' },
];

const categories = [
  { slug: 'flagship', vi: 'Cao cấp', en: 'Flagship' },
  { slug: 'mid-range', vi: 'Tầm trung', en: 'Mid-range' },
  { slug: 'budget', vi: 'Phổ thông', en: 'Budget' },
];

const phones: PhoneSeed[] = [
  {
    slug: 'iphone-16',
    brand: 'apple',
    category: 'flagship',
    price: 22990000,
    featured: true,
    storageGb: 128,
    ramGb: 8,
    screen: '6.1" OLED',
    file: 'File:Back of iPhone 16.jpg',
    vi: { name: 'iPhone 16', description: 'iPhone 16 với chip A18, camera 48MP và màn hình OLED 6.1 inch.', color: 'Đen' },
    en: { name: 'iPhone 16', description: 'iPhone 16 with the A18 chip, a 48MP camera, and a 6.1-inch OLED display.', color: 'Black' },
  },
  {
    slug: 'iphone-16-pro',
    brand: 'apple',
    category: 'flagship',
    price: 28990000,
    featured: true,
    storageGb: 256,
    ramGb: 8,
    screen: '6.3" OLED',
    file: 'File:Back of iPhone 16 Pro - 1.jpg',
    vi: { name: 'iPhone 16 Pro', description: 'iPhone 16 Pro, khung titan, camera 48MP và màn hình ProMotion 6.3 inch.', color: 'Titan tự nhiên' },
    en: { name: 'iPhone 16 Pro', description: 'iPhone 16 Pro with a titanium frame, a 48MP camera, and a 6.3-inch ProMotion display.', color: 'Natural titanium' },
  },
  {
    slug: 'galaxy-s24',
    brand: 'samsung',
    category: 'flagship',
    price: 19990000,
    featured: true,
    storageGb: 256,
    ramGb: 8,
    screen: '6.2" AMOLED',
    file: 'File:Samsung Galaxy S24 (webtekno) 005.png',
    vi: { name: 'Galaxy S24', description: 'Galaxy S24 với màn hình AMOLED 6.2 inch và camera 50MP.', color: 'Xám' },
    en: { name: 'Galaxy S24', description: 'Galaxy S24 with a 6.2-inch AMOLED display and a 50MP camera.', color: 'Gray' },
  },
  {
    slug: 'galaxy-a55',
    brand: 'samsung',
    category: 'mid-range',
    price: 9990000,
    featured: false,
    storageGb: 128,
    ramGb: 8,
    screen: '6.6" AMOLED',
    file: 'File:Galaxy A55.jpg',
    vi: { name: 'Galaxy A55', description: 'Galaxy A55 tầm trung, màn hình AMOLED 6.6 inch và pin 5000mAh.', color: 'Xanh' },
    en: { name: 'Galaxy A55', description: 'Mid-range Galaxy A55 with a 6.6-inch AMOLED display and a 5000mAh battery.', color: 'Navy' },
  },
  {
    slug: 'xiaomi-14',
    brand: 'xiaomi',
    category: 'flagship',
    price: 17990000,
    featured: true,
    storageGb: 256,
    ramGb: 12,
    screen: '6.36" OLED',
    file: 'File:Xiaomi 14.png',
    vi: { name: 'Xiaomi 14', description: 'Xiaomi 14 với Snapdragon 8 Gen 3, camera Leica và màn hình OLED 6.36 inch.', color: 'Đen' },
    en: { name: 'Xiaomi 14', description: 'Xiaomi 14 with Snapdragon 8 Gen 3, a Leica camera, and a 6.36-inch OLED display.', color: 'Black' },
  },
  {
    slug: 'redmi-note-14-pro',
    brand: 'xiaomi',
    category: 'budget',
    price: 8990000,
    featured: false,
    storageGb: 256,
    ramGb: 8,
    screen: '6.67" AMOLED',
    file: 'File:Redmi Note 14 Pro (2).jpg',
    vi: {
      name: 'Redmi Note 14 Pro',
      description: 'Redmi Note 14 Pro phổ thông, màn hình AMOLED 6.67 inch và camera 200MP.',
      color: 'Đen',
    },
    en: {
      name: 'Redmi Note 14 Pro',
      description: 'Budget Redmi Note 14 Pro with a 6.67-inch AMOLED display and a 200MP camera.',
      color: 'Black',
    },
  },
];

function phoneSvg(title: string): string {
  const label = title.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
  <rect width="400" height="400" fill="#f4f4f5"/>
  <rect x="130" y="50" width="140" height="300" rx="18" fill="#18181b"/>
  <rect x="142" y="70" width="116" height="240" rx="4" fill="#e4e4e7"/>
  <text x="200" y="190" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#18181b">${label}</text>
</svg>`;
}

async function commonsFile(title: string): Promise<{ url: string; mime: string } | null> {
  const api = new URL('https://commons.wikimedia.org/w/api.php');
  api.searchParams.set('action', 'query');
  api.searchParams.set('titles', title);
  api.searchParams.set('prop', 'imageinfo');
  api.searchParams.set('iiprop', 'url|mime');
  api.searchParams.set('iiurlwidth', '900');
  api.searchParams.set('format', 'json');
  const res = await fetch(api, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    query?: { pages?: Record<string, { imageinfo?: { thumburl?: string; url?: string; mime?: string }[] }> };
  };
  const page = Object.values(body.query?.pages ?? {})[0];
  const info = page?.imageinfo?.[0];
  const url = info?.thumburl || info?.url;
  const mime = info?.mime ?? '';
  if (!url || !mime.startsWith('image/')) return null;
  return { url, mime };
}

async function ensureImage(root: string, slug: string, file: string): Promise<string> {
  const dir = path.join(root, 'public', 'phones');
  fs.mkdirSync(dir, { recursive: true });
  for (const ext of ['jpg', 'png', 'webp', 'svg']) {
    const existing = path.join(dir, `${slug}.${ext}`);
    if (fs.existsSync(existing) && fs.statSync(existing).size > 200) return `/phones/${slug}.${ext}`;
  }
  try {
    const found = await commonsFile(file);
    if (found) {
      const ext = found.mime.includes('png') ? 'png' : found.mime.includes('webp') ? 'webp' : 'jpg';
      const img = await fetch(found.url, { headers: { 'User-Agent': UA } });
      if (img.ok) {
        const buf = Buffer.from(await img.arrayBuffer());
        if (buf.length > 500) {
          fs.writeFileSync(path.join(dir, `${slug}.${ext}`), buf);
          console.log(`  image ${slug} <- ${file}`);
          return `/phones/${slug}.${ext}`;
        }
      }
    }
  } catch (e) {
    console.warn(`  image ${slug} failed: ${(e as Error).message}`);
  }
  fs.writeFileSync(path.join(dir, `${slug}.svg`), phoneSvg(slug));
  console.warn(`  image ${slug} fallback svg`);
  return `/phones/${slug}.svg`;
}

async function main() {
  const root = findProjectRoot(__dirname);
  const envFile = path.join(root, '.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  process.env.OPENCMS_WEB = '0';

  const { AppModule } = await import('./app.module');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const entries = app.get(EntriesService);
    const brandIds = new Map<string, string>();
    for (const brand of brands) {
      brandIds.set(brand.slug, await publishEntry(entries, 'brand', brand.slug, { name: brand.name, slug: brand.slug }));
    }
    const categoryIds = new Map<string, string>();
    for (const category of categories) {
      categoryIds.set(
        category.slug,
        await publishEntry(entries, 'category', category.slug, { name: category.vi, slug: category.slug }, { name: category.en }),
      );
    }
    for (const phone of phones) {
      const image = await ensureImage(root, phone.slug, phone.file);
      const brand = brandIds.get(phone.brand);
      const category = categoryIds.get(phone.category);
      if (!brand || !category) throw new Error(`Missing brand or category for ${phone.slug}`);
      const shared = {
        slug: phone.slug,
        price: { amount: phone.price, currency: 'VND' },
        featured: phone.featured,
        image,
        brand,
        category,
        storageGb: phone.storageGb,
        ramGb: phone.ramGb,
        screen: phone.screen,
      };
      await publishEntry(
        entries,
        'phone',
        phone.slug,
        { ...shared, name: phone.vi.name, description: phone.vi.description, color: phone.vi.color },
        { name: phone.en.name, description: phone.en.description, color: phone.en.color },
      );
    }
    console.log('Seeded phone catalog.');
  } finally {
    await app.close();
  }
}

async function publishEntry(entries: EntriesService, apiId: string, slug: string, vi: Body, en?: Body): Promise<string> {
  const published = await find(entries, apiId, slug, 'published');
  if (published) {
    console.log(`  skip ${apiId} ${slug}`);
    return published;
  }
  const draft = await find(entries, apiId, slug, 'draft');
  const created = draft ? undefined : await entries.create(apiId, vi, 'vi-VN');
  const id = draft ?? created?.data.documentId;
  if (!id) throw new Error(`Could not create ${apiId} ${slug}`);
  if (draft) await entries.update(apiId, id, vi, 'vi-VN');
  if (en) await entries.update(apiId, id, en, 'en-US');
  await entries.publish(apiId, id, publisher);
  console.log(`  publish ${apiId} ${slug}`);
  return id;
}

async function find(entries: EntriesService, apiId: string, slug: string, status: 'draft' | 'published'): Promise<string | undefined> {
  const res = await entries.list(apiId, { status, filter: { slug }, limit: 1, locale: 'vi-VN' });
  return res.data[0]?.documentId as string | undefined;
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
