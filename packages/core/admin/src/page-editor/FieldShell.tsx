import type { ReactNode } from 'react';
import { Label } from '../components/ui/label';
import { t } from '../i18n';

/** Label of a Puck field: its `label`, else the last segment of its name (`items[0].title` → `title`). */
export function fieldLabel(field: { label?: string }, name: string, label?: string): string {
  return label ?? field.label ?? name.replace(/\[\d+\]/g, '').split('.').pop() ?? name;
}

/** Label + control, the layout of every field in the editor's side panel. */
export function FieldShell({ id, label, children, as = 'label' }: { id: string; label: string; children: ReactNode; as?: 'label' | 'legend' }) {
  if (as === 'legend') {
    return (
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">{label}</legend>
        {children}
      </fieldset>
    );
  }
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

/** Inline warning for a stored binding to a private content type: it renders nothing on pages (spec §7). */
export function PrivateTypeNote({ apiId }: { apiId: string }) {
  return (
    <p data-private-type="" role="status" className="rounded-md border border-warning/50 bg-warning/10 px-2 py-1 text-xs text-warning">
      {t('pageEditor.fields.privateType', { type: apiId })}
    </p>
  );
}
