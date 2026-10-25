import '../globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { createTranslator } from '@opencloudcms/core';
import { SiteHeader } from './components/site-header';
import { getSiteLocale } from './locale';
import { messages } from './messages';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getSiteLocale();
  const t = createTranslator(messages, locale);
  return { title: t('brand') };
}

export default async function SiteLayout({ children }: { children: ReactNode }) {
  const locale = await getSiteLocale();
  const t = createTranslator(messages, locale);
  return (
    <html lang={locale}>
      <body className="bg-background text-foreground antialiased">
        <SiteHeader locale={locale} brand={t('brand')} phones={t('nav.phones')} admin={t('nav.admin')} />
        {children}
      </body>
    </html>
  );
}
