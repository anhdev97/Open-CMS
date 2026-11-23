import type { Locale } from '@opencloudcms/schema';
import { siteMessages } from './messages';
import { exitUrl } from './shared';

export type PreviewBarVariant = 'draft' | 'expired';

const LINK = 'font-medium underline underline-offset-4 hover:opacity-80';

/**
 * Fixed bar shown while draft mode is on (spec §8.2). `draft`: "Viewing draft · Exit". `expired`: the admin session is
 * gone or lacks `content.read`, so the published page is shown with a sign-in link (and Exit to leave draft mode).
 */
export function PreviewBar({ variant, locale, path }: { variant: PreviewBarVariant; locale: Locale; path: string }) {
  const m = siteMessages(locale);
  return (
    <div
      data-opencloudcms-preview={variant}
      role="status"
      lang={locale}
      className="fixed inset-x-0 bottom-0 z-50 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-foreground px-4 py-2 text-sm text-background shadow-lg"
    >
      {variant === 'draft' ? (
        <>
          <span>{m.draft}</span>
          <span aria-hidden="true">·</span>
          <a href={exitUrl(path)} className={LINK}>
            {m.exit}
          </a>
        </>
      ) : (
        <>
          <span>{m.expired}</span>
          <a href="/admin/login" className={LINK}>
            {m.signIn}
          </a>
          <span aria-hidden="true">·</span>
          <a href={exitUrl(path)} className={LINK}>
            {m.exit}
          </a>
        </>
      )}
    </div>
  );
}
