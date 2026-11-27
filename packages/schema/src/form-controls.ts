// Form control names, options and allow-lists (Input, Textarea, Select, Combobox, Radio, Checkbox, Switch).
// Must not import from `node:*`.
import type { ComposedIssue } from './composed-block';
import { validateLocalizedText } from './groups';
import type { LocalizedText } from './i18n';

/** The `name` of a form control. */
export const FORM_CONTROL_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export const INPUT_TYPES = ['text', 'email', 'tel', 'number', 'url', 'password', 'date'] as const;
export type InputType = (typeof INPUT_TYPES)[number];

/** `autocomplete` tokens an Input may carry (omitted = browser default). */
export const AUTOCOMPLETE_TOKENS = [
  'name', 'given-name', 'family-name', 'email', 'tel', 'street-address', 'postal-code', 'country', 'organization',
  'username', 'current-password', 'new-password', 'bday', 'off',
] as const;

export type ControlOption = { value: string; label: string | LocalizedText };

export const MAX_OPTIONS = 100;
export const MAX_OPTION_VALUE = 100;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Options of Select, Combobox and Radio: 1-100 entries, `value` non-empty ≤ 100 chars and unique, `label` non-empty. */
export function validateOptions(v: unknown, path: (string | number)[]): ComposedIssue[] {
  const issues: ComposedIssue[] = [];
  const add = (p: (string | number)[], message: string) => issues.push({ path: p, message });
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_OPTIONS) return [{ path, message: `options must be an array of 1 to ${MAX_OPTIONS} entries` }];
  const seen = new Set<string>();
  v.forEach((o, i) => {
    const p = [...path, i];
    if (!isObj(o)) return add(p, 'option must be an object with value and label');
    if (typeof o.value !== 'string' || !o.value || o.value.length > MAX_OPTION_VALUE) {
      add([...p, 'value'], `value must be a non-empty string of at most ${MAX_OPTION_VALUE} characters`);
    } else if (seen.has(o.value)) add([...p, 'value'], `duplicate option value "${o.value}"`);
    else seen.add(o.value);
    if (typeof o.label === 'string') {
      if (!o.label.trim()) add([...p, 'label'], 'label must not be empty');
    } else {
      const m = validateLocalizedText(o.label, 'label');
      if (m.length) add([...p, 'label'], m.join('; '));
    }
  });
  return issues;
}

/** Values of valid options (for `defaultValue` checks). */
export function optionValues(v: unknown): string[] {
  return Array.isArray(v) ? v.flatMap((o) => (isObj(o) && typeof o.value === 'string' ? [o.value] : [])) : [];
}
