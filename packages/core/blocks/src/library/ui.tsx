// Presentational primitives for the core block library. They mirror the admin shadcn components
// (admin/src/components/ui/{button,badge,card}.tsx) with the same design tokens, but have no admin-only
// dependencies (router, i18n, radix) so they are safe in server components, Nest (CJS) and the editor iframe.
// Class names are literal strings so Tailwind's `@source` scan of dist/blocks finds them.
import type { ReactNode } from 'react';
import type { ButtonAction } from '@opencloudcms/schema';
import { ActionButton } from '../client/ActionButton';
import { validAction } from '../ui/content';
import {
  ALIGN, BADGE_VARIANT, BG, BUTTON_BASE, BUTTON_SIZE, BUTTON_VARIANT, COLS, GAP, GRID_COLS, H, JUSTIFY, MY, PY, cn,
  type BadgeVariant, type ButtonSize, type ButtonVariant,
} from '../ui/tokens';
import { safeHref } from '../ui/href';

export const L = (en: string, vi: string, fr: string, id: string) => ({ 'en-US': en, 'vi-VN': vi, 'fr-FR': fr, 'id-ID': id });

export { ALIGN, BG, COLS, GAP, GRID_COLS, H, JUSTIFY, MY, PY, cn };
export type { BadgeVariant, ButtonSize, ButtonVariant };

/**
 * A link-styled button: an anchor when `href` resolved to a safe target (`safeHref`), otherwise an inert span (never a
 * dead `<a>`). With a valid `action`, a `<button type="button">` (client `ActionButton`) with the same classes.
 */
export function LinkButton({
  label, href, variant = 'default', size = 'default', className, action,
}: { label: string; href: string | null | undefined; variant?: ButtonVariant; size?: ButtonSize; className?: string; action?: ButtonAction | null }) {
  const cls = cn(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], className);
  const act = validAction(action);
  if (act) return <ActionButton action={act} className={cls}>{label}</ActionButton>;
  const safe = safeHref(href);
  return safe ? (
    <a data-slot="button" href={safe} className={cls}>{label}</a>
  ) : (
    <span data-slot="button" className={cls}>{label}</span>
  );
}

export function BadgePill({ children, variant = 'default', className }: { children: ReactNode; variant?: BadgeVariant; className?: string }) {
  return (
    <span
      data-slot="badge"
      className={cn('inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap', BADGE_VARIANT[variant], className)}
    >
      {children}
    </span>
  );
}

export function CardBox({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div data-slot="card" className={cn('flex flex-col gap-4 overflow-hidden rounded-xl border bg-card py-6 text-card-foreground shadow-xs', className)}>
      {children}
    </div>
  );
}
