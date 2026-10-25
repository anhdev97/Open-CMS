import { headers } from 'next/headers';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Providers from './Providers';

export const metadata: Metadata = {
  title: 'OpenCloudCMS Admin',
  robots: { index: false, follow: false },
};

const THEME_SCRIPT = `
      (function () {
        try {
          var t = localStorage.getItem('opencloudcms-theme');
          var dark = t === 'dark' || ((t !== 'light') && window.matchMedia('(prefers-color-scheme: dark)').matches);
          document.documentElement.classList.toggle('dark', dark);
        } catch (e) {}
      })();
    `;

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const csp = (await headers()).get('content-security-policy') ?? '';
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body data-opencloudcms-admin="">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
