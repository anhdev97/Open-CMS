import Link from 'next/link';
import { LocaleSwitch } from './locale-switch';
import type { SiteLocale } from '../locale';

export function SiteHeader({
  locale,
  brand,
  phones,
  admin,
}: {
  locale: SiteLocale;
  brand: string;
  phones: string;
  admin: string;
}) {
  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-4">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          {brand}
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/phones" className="text-muted-foreground hover:text-foreground">
            {phones}
          </Link>
          <a href="/admin" className="text-muted-foreground hover:text-foreground">
            {admin}
          </a>
        </nav>
        <div className="ml-auto">
          <LocaleSwitch locale={locale} />
        </div>
      </div>
    </header>
  );
}
