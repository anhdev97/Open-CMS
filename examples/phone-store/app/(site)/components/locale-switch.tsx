'use client';

import { Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { setSiteLocale } from '../locale-action';
import type { SiteLocale } from '../locale';

function LocaleSwitchForm({ locale }: { locale: SiteLocale }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const query = search.toString();
  const next = query ? `${pathname}?${query}` : pathname;

  return (
    <form action={setSiteLocale} className="flex rounded-md border text-sm">
      <input type="hidden" name="next" value={next} />
      <LocaleButton locale="vi-VN" current={locale} label="VI" />
      <LocaleButton locale="en-US" current={locale} label="EN" />
    </form>
  );
}

function LocaleButton({ locale, current, label }: { locale: SiteLocale; current: SiteLocale; label: string }) {
  const active = locale === current;
  return (
    <button
      type="submit"
      name="locale"
      value={locale}
      aria-pressed={active}
      className={
        active
          ? 'bg-primary px-2.5 py-1 font-medium text-primary-foreground'
          : 'px-2.5 py-1 text-muted-foreground hover:text-foreground'
      }
    >
      {label}
    </button>
  );
}

export function LocaleSwitch({ locale }: { locale: SiteLocale }) {
  return (
    <Suspense fallback={<span className="text-sm text-muted-foreground">{locale === 'en-US' ? 'EN' : 'VI'}</span>}>
      <LocaleSwitchForm locale={locale} />
    </Suspense>
  );
}
