import type { ReactNode } from 'react';
import { Label } from '../components/ui/label';

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
