import '../globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ThemeStyle } from '@opencloudcms/core/blocks';
import locales from '../../src/locales';
import theme from '../../src/theme';

export const metadata: Metadata = {
  title: 'my-store',
};

// ThemeStyle writes the brand colors of src/theme.ts (active palette) as --ocms-color-* variables; blocks use them
// as `brand:<name>`. `ocms-site` scopes the storefront typography of app/globals.css to the website.
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={locales.defaultLocale}>
      <head>
        <ThemeStyle theme={theme} />
      </head>
      <body className="ocms-site bg-(--ocms-color-surface) text-(--ocms-color-ink) antialiased">{children}</body>
    </html>
  );
}
