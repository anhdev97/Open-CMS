import type { Locale } from '@opencloudcms/schema';
import { siteMessages } from './messages';

const BUTTON = 'inline-flex h-9 items-center rounded-md px-4 text-sm font-medium';

/** Shown at `/` while no page is published there (spec §10): the former sample home page plus "Build your first page". */
export function Welcome({ locale, siteName }: { locale: Locale; siteName?: string }) {
  const m = siteMessages(locale);
  return (
    <main data-opencloudcms-site="" lang={locale} className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6">
      <h1 className="text-3xl font-semibold tracking-tight">{siteName || m.welcomeTitle}</h1>
      <p className="text-muted-foreground">{m.welcomeText}</p>
      <p className="flex flex-wrap gap-2">
        <a href="/admin/pages" className={`${BUTTON} bg-primary text-primary-foreground hover:bg-primary/90`}>
          {m.buildFirstPage}
        </a>
        <a href="/admin" className={`${BUTTON} border border-input bg-background hover:bg-accent hover:text-accent-foreground`}>
          {m.openAdmin}
        </a>
      </p>
    </main>
  );
}
