import { LockIcon } from 'lucide-react';
import { t } from '../i18n';
import { cn } from '../lib/utils';

/** Lock marking a private content type (spec §7) in the sidebar and page headers. */
export function PrivateLock({ className }: { className?: string }) {
  return (
    <span data-private-lock="" role="img" aria-label={t('content.privateType')} title={t('content.privateType')} className={cn('inline-flex text-muted-foreground', className)}>
      <LockIcon className="size-full" aria-hidden="true" />
    </span>
  );
}
