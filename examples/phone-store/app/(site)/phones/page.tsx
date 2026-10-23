import Link from 'next/link';
import type { ReactNode } from 'react';
import { createTranslator } from '@opencms/core';
import { PhoneCard } from '../components/phone-card';
import { formatPrice, idForSlug, listBrands, listCategories, listPhones, type NamedEntry } from '../content';
import { getSiteLocale } from '../locale';
import { messages } from '../messages';

function filterHref(brand: string | undefined, category: string | undefined): string {
  const params = new URLSearchParams();
  if (brand) params.set('brand', brand);
  if (category) params.set('category', category);
  const query = params.toString();
  return query ? `/phones?${query}` : '/phones';
}

function FilterRow({
  label,
  all,
  current,
  other,
  param,
  entries,
}: {
  label: string;
  all: string;
  current: string | undefined;
  other: { brand?: string; category?: string };
  param: 'brand' | 'category';
  entries: NamedEntry[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-24 text-sm text-muted-foreground">{label}</span>
      <FilterChip href={filterHref(other.brand, other.category)} active={!current}>
        {all}
      </FilterChip>
      {entries.map((entry) => (
        <FilterChip
          key={entry.documentId}
          href={filterHref(
            param === 'brand' ? (entry.slug ?? undefined) : other.brand,
            param === 'category' ? (entry.slug ?? undefined) : other.category,
          )}
          active={current === entry.slug}
        >
          {entry.name}
        </FilterChip>
      ))}
    </div>
  );
}

function FilterChip({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={
        active
          ? 'rounded-full bg-primary px-3 py-1 text-sm text-primary-foreground'
          : 'rounded-full border px-3 py-1 text-sm text-muted-foreground hover:text-foreground'
      }
    >
      {children}
    </Link>
  );
}

export default async function PhonesPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string; category?: string }>;
}) {
  const locale = await getSiteLocale();
  const t = createTranslator(messages, locale);
  const { brand, category } = await searchParams;
  const [brands, categories] = await Promise.all([listBrands(locale), listCategories(locale)]);
  const filter: Record<string, string> = {};
  const brandId = idForSlug(brands, brand);
  const categoryId = idForSlug(categories, category);
  if (brandId) filter.brand = brandId;
  if (categoryId) filter.category = categoryId;
  const phones = await listPhones(locale, filter);
  const brandName = new Map(brands.map((entry) => [entry.documentId, entry.name]));

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">{t('catalog.title')}</h1>
      <div className="flex flex-col gap-3">
        <FilterRow
          label={t('catalog.brands')}
          all={t('catalog.all')}
          current={brand}
          other={{ category }}
          param="brand"
          entries={brands}
        />
        <FilterRow
          label={t('catalog.categories')}
          all={t('catalog.all')}
          current={category}
          other={{ brand }}
          param="category"
          entries={categories}
        />
        {brand || category ? (
          <Link href="/phones" className="text-sm text-muted-foreground hover:text-foreground">
            {t('catalog.clear')}
          </Link>
        ) : null}
      </div>
      {phones.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {phones.map((phone) => (
            <PhoneCard
              key={phone.documentId}
              phone={phone}
              brandName={phone.brand ? (brandName.get(phone.brand) ?? null) : null}
              price={formatPrice(phone.price, locale)}
            />
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground">{t('catalog.empty')}</p>
      )}
    </main>
  );
}
