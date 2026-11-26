// Native form controls (no submission: UI only). Each control gets its id from `useId` (unique per rendered copy),
// a `<label for>` and its help text through `aria-describedby`. Isomorphic: no state, no browser globals.
import { useId, type ReactNode } from 'react';
import type { NodeStyle } from '@opencloudcms/schema';
import { cn } from './tokens';
import { styleAttr, styleProps } from './style';

export const FIELD = 'grid gap-1.5';
export const FIELD_LABEL = 'text-sm font-medium leading-none';
export const FIELD_HELP = 'text-sm text-muted-foreground';
export const FIELD_REQUIRED = 'text-destructive';
/** Shared look of text inputs, textareas and selects (theme border, radius and focus ring). */
export const CONTROL =
  'w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-base text-foreground shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 md:text-sm';
export const INPUT_H = 'h-9';
export const CHECK =
  'size-4 shrink-0 rounded-sm border border-input accent-primary outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50';
export const CHOICE_ROW = 'flex items-center gap-2 text-sm';
export const RADIO_GROUP: Record<'vertical' | 'horizontal', string> = {
  vertical: 'flex flex-col gap-2',
  horizontal: 'flex flex-row flex-wrap gap-x-6 gap-y-2',
};
export const SWITCH_LABEL = 'inline-flex cursor-pointer items-center gap-2 text-sm';
export const SWITCH_INPUT = 'peer sr-only';
/** The visible track and thumb of a Switch, driven by the (visually hidden) checkbox before it. */
export const SWITCH_TRACK =
  "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-input transition-colors after:absolute after:left-0.5 after:size-4 after:rounded-full after:bg-background after:shadow-xs after:transition-transform after:content-[''] peer-checked:bg-primary peer-checked:after:translate-x-4 peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background peer-disabled:cursor-not-allowed peer-disabled:opacity-50";

export type ControlOption = { value: string; label: string };

type Base = {
  name: string;
  label?: string;
  help?: string;
  disabled?: boolean;
  /** Element id of the field wrapper (scroll target); the control's own id comes from `useId`. */
  id?: string;
  style?: NodeStyle;
};

const nonEmpty = (s: string | undefined): string | undefined => (typeof s === 'string' && s.trim() ? s : undefined);

/** Ids of one control: the control, and its help text when there is one. */
function useControlIds(help: string | undefined) {
  const id = useId();
  return { id, helpId: nonEmpty(help) ? `${id}-help` : undefined };
}

function Label({ htmlFor, text, required }: { htmlFor: string; text?: string; required?: boolean }) {
  if (!nonEmpty(text)) return null;
  return (
    <label htmlFor={htmlFor} className={FIELD_LABEL}>
      {text}
      {required ? <span aria-hidden="true" className={FIELD_REQUIRED}> *</span> : null}
    </label>
  );
}

const Help = ({ id, text }: { id?: string; text?: string }) => (id ? <p id={id} className={FIELD_HELP}>{text}</p> : null);

function Field({ id, style, children }: { id?: string; style?: NodeStyle; children: ReactNode }) {
  const sp = styleProps(style, 'grid');
  return <div id={id} className={cn(FIELD, sp.className)} style={styleAttr(sp)}>{children}</div>;
}

export type InputType = 'text' | 'email' | 'tel' | 'number' | 'url' | 'password' | 'date';
const INPUT_TYPE_LIST: readonly InputType[] = ['text', 'email', 'tel', 'number', 'url', 'password', 'date'];

export function Input({
  name, type, label, placeholder, help, required, disabled, autocomplete, id, style,
}: Base & { type?: InputType; placeholder?: string; required?: boolean; autocomplete?: string }) {
  const ids = useControlIds(help);
  return (
    <Field id={id} style={style}>
      <Label htmlFor={ids.id} text={label} required={required} />
      <input
        id={ids.id}
        name={name}
        type={INPUT_TYPE_LIST.includes(type as InputType) ? type : 'text'}
        placeholder={nonEmpty(placeholder)}
        required={required || undefined}
        disabled={disabled || undefined}
        autoComplete={nonEmpty(autocomplete)}
        aria-describedby={ids.helpId}
        className={cn(CONTROL, INPUT_H)}
      />
      <Help id={ids.helpId} text={help} />
    </Field>
  );
}

export function Textarea({
  name, rows, label, placeholder, help, required, disabled, id, style,
}: Base & { rows?: number; placeholder?: string; required?: boolean }) {
  const ids = useControlIds(help);
  const r = Number.isInteger(rows) && rows! >= 2 && rows! <= 12 ? rows : 4;
  return (
    <Field id={id} style={style}>
      <Label htmlFor={ids.id} text={label} required={required} />
      <textarea
        id={ids.id}
        name={name}
        rows={r}
        placeholder={nonEmpty(placeholder)}
        required={required || undefined}
        disabled={disabled || undefined}
        aria-describedby={ids.helpId}
        className={CONTROL}
      />
      <Help id={ids.helpId} text={help} />
    </Field>
  );
}

/** Native select; also the server (no-JS) form of the Combobox. */
export function Select({
  name, options, defaultValue, label, placeholder, help, required, disabled, id, style,
}: Base & { options: ControlOption[]; defaultValue?: string; placeholder?: string; required?: boolean }) {
  const ids = useControlIds(help);
  const ph = nonEmpty(placeholder);
  const known = typeof defaultValue === 'string' && options.some((o) => o.value === defaultValue);
  return (
    <Field id={id} style={style}>
      <Label htmlFor={ids.id} text={label} required={required} />
      <select
        id={ids.id}
        name={name}
        defaultValue={known ? defaultValue : ph ? '' : undefined}
        required={required || undefined}
        disabled={disabled || undefined}
        aria-describedby={ids.helpId}
        className={cn(CONTROL, INPUT_H)}
      >
        {ph ? <option value="" disabled>{ph}</option> : null}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <Help id={ids.helpId} text={help} />
    </Field>
  );
}

export function Radio({
  name, options, defaultValue, orientation, label, help, required, disabled, id, style,
}: Base & { options: ControlOption[]; defaultValue?: string; orientation?: 'vertical' | 'horizontal'; required?: boolean }) {
  const ids = useControlIds(help);
  const sp = styleProps(style, 'block');
  return (
    <fieldset id={id} aria-describedby={ids.helpId} disabled={disabled || undefined} className={cn('grid gap-2', sp.className)} style={styleAttr(sp)}>
      {nonEmpty(label) ? (
        <legend className={cn(FIELD_LABEL, 'mb-1')}>
          {label}
          {required ? <span aria-hidden="true" className={FIELD_REQUIRED}> *</span> : null}
        </legend>
      ) : null}
      <div className={RADIO_GROUP[orientation as 'vertical'] ?? RADIO_GROUP.vertical}>
        {options.map((o, i) => (
          <label key={o.value} className={CHOICE_ROW}>
            <input
              type="radio"
              id={`${ids.id}-${i}`}
              name={name}
              value={o.value}
              defaultChecked={o.value === defaultValue || undefined}
              required={required || undefined}
              className={cn(CHECK, 'rounded-full')}
            />
            {o.label}
          </label>
        ))}
      </div>
      <Help id={ids.helpId} text={help} />
    </fieldset>
  );
}

export function Checkbox({
  name, value, defaultChecked, label, help, required, disabled, id, style,
}: Base & { value?: string; defaultChecked?: boolean; required?: boolean }) {
  const ids = useControlIds(help);
  return (
    <Field id={id} style={style}>
      <div className={CHOICE_ROW}>
        <input
          type="checkbox"
          id={ids.id}
          name={name}
          value={nonEmpty(value) ?? 'on'}
          defaultChecked={defaultChecked || undefined}
          required={required || undefined}
          disabled={disabled || undefined}
          aria-describedby={ids.helpId}
          className={CHECK}
        />
        <Label htmlFor={ids.id} text={label} required={required} />
      </div>
      <Help id={ids.helpId} text={help} />
    </Field>
  );
}

export function Switch({ name, defaultChecked, label, help, disabled, id, style }: Base & { defaultChecked?: boolean }) {
  const ids = useControlIds(help);
  return (
    <Field id={id} style={style}>
      <label htmlFor={ids.id} className={SWITCH_LABEL}>
        <input
          type="checkbox"
          role="switch"
          id={ids.id}
          name={name}
          defaultChecked={defaultChecked || undefined}
          disabled={disabled || undefined}
          aria-describedby={ids.helpId}
          className={SWITCH_INPUT}
        />
        <span aria-hidden="true" className={SWITCH_TRACK} />
        {nonEmpty(label) ? <span>{label}</span> : null}
      </label>
      <Help id={ids.helpId} text={help} />
    </Field>
  );
}
