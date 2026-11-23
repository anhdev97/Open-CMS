import { TriangleAlertIcon } from 'lucide-react';
import { t } from '../i18n';

/** Canvas placeholder for a block that is no longer in the project's `blocks` (delete only, see editor-config). */
export function UnknownBlock({ name }: { name: string }) {
  return (
    <div role="note" className="m-2 flex items-center gap-2 rounded-md border border-dashed border-warning bg-warning-soft p-4 text-sm text-warning">
      <TriangleAlertIcon aria-hidden="true" className="size-4 shrink-0" />
      {t('pageEditor.unknownBlock', { name })}
    </div>
  );
}
