import type { SiteLocale } from './locale';

export interface NamedEntry {
  documentId: string;
  name: string | null;
  slug: string | null;
}

export interface Phone extends NamedEntry {
  description: string | null;
  price: { amount: number; currency: string } | null;
  featured: boolean | null;
  image: string | null;
  brand: string | null;
  category: string | null;
  storageGb: number | null;
  ramGb: number | null;
  color: string | null;
  screen: string | null;
}

function apiBase(): string {
  return `http://127.0.0.1:${process.env.PORT ?? '4001'}`;
}

async function list<T>(apiId: string, locale: SiteLocale, filter: Record<string, string> = {}): Promise<T[]> {
  const url = new URL(`/api/content/${apiId}`, apiBase());
  url.searchParams.set('locale', locale);
  url.searchParams.set('fallback', locale === 'vi-VN' ? 'en-US' : 'vi-VN');
  url.searchParams.set('limit', '48');
  url.searchParams.set('sort', 'name:asc');
  for (const [key, value] of Object.entries(filter)) url.searchParams.set(`filter[${key}]`, value);
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status} ${url.pathname}${url.search}`);
  const body = (await res.json()) as { data: T[] };
  return body.data;
}

export function listBrands(locale: SiteLocale) {
  return list<NamedEntry>('brand', locale);
}

export function listCategories(locale: SiteLocale) {
  return list<NamedEntry>('category', locale);
}

export function listPhones(locale: SiteLocale, filter: Record<string, string> = {}) {
  return list<Phone>('phone', locale, filter);
}

const EMPTY_ID = '00000000-0000-4000-8000-000000000000';

/** Resolve a slug filter to a document id. An unknown slug matches nothing. */
export function idForSlug(entries: NamedEntry[], slug: string | undefined): string | undefined {
  if (!slug) return undefined;
  return entries.find((entry) => entry.slug === slug)?.documentId ?? EMPTY_ID;
}

export function formatPrice(price: Phone['price'], locale: SiteLocale): string | null {
  if (!price) return null;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: price.currency,
    maximumFractionDigits: 0,
  }).format(price.amount);
}
