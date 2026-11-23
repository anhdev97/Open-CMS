import type { CustomFieldRender } from '@puckeditor/core';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { FieldShell, fieldLabel } from './FieldShell';
import { tokenOptions } from './field-logic';

// Literal classes so Tailwind sees them (token names are the theme's colour tokens).
const SWATCH: Record<string, string> = {
  primary: 'bg-primary',
  secondary: 'bg-secondary',
  muted: 'bg-muted',
  accent: 'bg-accent',
  background: 'bg-background',
  foreground: 'bg-foreground',
  destructive: 'bg-destructive',
};

/** `b.color` / `b.spacing`: a select over the design-system tokens only (no free values). */
export const TokenField: CustomFieldRender<string> = ({ field, name, id, value, onChange, readOnly }) => {
  const kind = (field.metadata?.blockField as { kind?: string } | undefined)?.kind === 'color' ? 'color' : 'spacing';
  return (
    <FieldShell id={id} label={fieldLabel(field, name)}>
      <Select value={value || undefined} disabled={readOnly} onValueChange={(v) => onChange(v)}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {tokenOptions(kind).map((token) => (
            <SelectItem key={token} value={token}>
              {kind === 'color' && <span aria-hidden="true" className={`size-3 rounded-sm border border-border ${SWATCH[token]}`} />}
              {token}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldShell>
  );
};
