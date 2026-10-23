import '../globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import locales from '../../src/locales';

export const metadata: Metadata = {
  title: 'my-store',
};

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={locales.defaultLocale}>
      <body className="bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
