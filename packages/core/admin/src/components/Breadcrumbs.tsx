import { ChevronRightIcon } from 'lucide-react';
import { Fragment } from 'react';
import { t } from '../i18n';
import { Link } from '../lib/nav';

export interface Crumb {
  label: string;
  /** Admin-relative path; the last crumb (the current page) has none. */
  to?: string;
}

/** Breadcrumb trail above a sub-page's header. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label={t('content.breadcrumb')}>
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        {items.map((c, i) => (
          <Fragment key={`${i}:${c.label}`}>
            {i > 0 && (
              <li role="presentation" aria-hidden="true">
                <ChevronRightIcon className="size-3.5" />
              </li>
            )}
            <li className="min-w-0 truncate">
              {c.to ? (
                <Link to={c.to} className="transition-colors hover:text-foreground">
                  {c.label}
                </Link>
              ) : (
                <span aria-current="page" className="font-medium text-foreground">
                  {c.label}
                </span>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
