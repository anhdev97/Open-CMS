// Design-system renderers for Puck's built-in field types (Puck `overrides.fieldTypes`).
import { useId } from 'react';
import type { FieldRenderFunctions } from '@puckeditor/core';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import { FieldShell, fieldLabel } from './FieldShell';

type Option = { label: string; value: unknown };
type Props = {
  field: { label?: string; placeholder?: string; options?: Option[]; min?: number; max?: number; step?: number };
  name: string;
  id?: string;
  label?: string;
  value: unknown;
  onChange: (v: unknown) => void;
  readOnly?: boolean;
};

function TextField({ field, name, id, label, value, onChange, readOnly }: Props) {
  const fallback = useId();
  const fid = id ?? fallback;
  return (
    <FieldShell id={fid} label={fieldLabel(field, name, label)}>
      <Input id={fid} value={typeof value === 'string' ? value : ''} placeholder={field.placeholder} readOnly={readOnly} onChange={(e) => onChange(e.target.value)} />
    </FieldShell>
  );
}

function TextareaField({ field, name, id, label, value, onChange, readOnly }: Props) {
  const fallback = useId();
  const fid = id ?? fallback;
  return (
    <FieldShell id={fid} label={fieldLabel(field, name, label)}>
      <Textarea id={fid} value={typeof value === 'string' ? value : ''} placeholder={field.placeholder} readOnly={readOnly} onChange={(e) => onChange(e.target.value)} />
    </FieldShell>
  );
}

function NumberField({ field, name, id, label, value, onChange, readOnly }: Props) {
  const fallback = useId();
  const fid = id ?? fallback;
  return (
    <FieldShell id={fid} label={fieldLabel(field, name, label)}>
      <Input
        id={fid}
        type="number"
        min={field.min}
        max={field.max}
        step={field.step ?? 'any'}
        readOnly={readOnly}
        value={typeof value === 'number' && Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    </FieldShell>
  );
}

/** Radix Select values are strings: options are addressed by index. */
function SelectField({ field, name, id, label, value, onChange, readOnly }: Props) {
  const fallback = useId();
  const fid = id ?? fallback;
  const options = field.options ?? [];
  const index = options.findIndex((o) => o.value === value);
  return (
    <FieldShell id={fid} label={fieldLabel(field, name, label)}>
      <Select value={index < 0 ? undefined : String(index)} disabled={readOnly} onValueChange={(v) => onChange(options[Number(v)]?.value)}>
        <SelectTrigger id={fid} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o, i) => (
            <SelectItem key={i} value={String(i)}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldShell>
  );
}

function RadioField({ field, name, id, label, value, onChange, readOnly }: Props) {
  const fallback = useId();
  const fid = id ?? fallback;
  return (
    <FieldShell id={fid} as="legend" label={fieldLabel(field, name, label)}>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {(field.options ?? []).map((o, i) => (
          <label key={i} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={fid}
              className="size-4 accent-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              checked={o.value === value}
              disabled={readOnly}
              onChange={() => onChange(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
    </FieldShell>
  );
}

/** Replaces Puck's own inputs; rich text, arrays and custom fields keep their renderers. */
export const fieldTypes = {
  text: TextField,
  textarea: TextareaField,
  number: NumberField,
  select: SelectField,
  radio: RadioField,
} as unknown as Partial<FieldRenderFunctions>;
