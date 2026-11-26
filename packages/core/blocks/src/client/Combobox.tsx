'use client';
// Combobox: the server (and the first client render) is the native `<select>` (`ui.Select`), so it works without JS.
// After hydration it becomes an ARIA 1.2 combobox: a text input `role="combobox"` filtering a `role="listbox"` popup
// (case- and accent-insensitive contains, `foldSearch`), and a hidden input that keeps the control's `name` and value.
// No browser globals at import time.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import { foldSearch, type NodeStyle } from '@opencloudcms/schema';
import { cn } from '../ui/tokens';
import { CONTROL, Field, Help, INPUT_H, Label, Select, fallbackLabel, nonEmpty, type ControlOption } from '../ui/form';

export const COMBOBOX_BOX = 'relative';
export const COMBOBOX_INPUT = 'pr-8';
export const COMBOBOX_CHEVRON = 'pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground';
export const COMBOBOX_LIST =
  'absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md';
export const COMBOBOX_OPTION = 'cursor-pointer rounded-sm px-2 py-1.5 text-sm aria-selected:font-medium data-[active]:bg-accent data-[active]:text-accent-foreground';
export const COMBOBOX_EMPTY = 'px-2 py-1.5 text-sm text-muted-foreground';

const NO_MATCH: Record<string, string> = {
  'en-US': 'No matches',
  'vi-VN': 'Không có kết quả phù hợp',
  'fr-FR': 'Aucun résultat',
  'id-ID': 'Tidak ada yang cocok',
};

export type ComboboxProps = {
  name: string;
  options: ControlOption[];
  defaultValue?: string;
  label?: string;
  placeholder?: string;
  help?: string;
  required?: boolean;
  disabled?: boolean;
  locale?: string;
  id?: string;
  style?: NodeStyle;
};

/** Options whose label contains `query`, ignoring case and accents. */
export function filterOptions(options: ControlOption[], query: string): ControlOption[] {
  const q = foldSearch(query.trim());
  return q ? options.filter((o) => foldSearch(o.label).includes(q)) : options;
}

export function Combobox(props: ComboboxProps) {
  const [hydrated, setHydrated] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const [initial, setInitial] = useState<string | undefined>(undefined);
  useEffect(() => {
    // Keep a choice the visitor made in the native select before hydration (not the select's own default).
    const sel = host.current?.querySelector('select');
    if (sel) {
      const opts = Array.from(sel.options);
      const initialIndex = Math.max(0, opts.findIndex((o) => o.defaultSelected));
      if (sel.value && sel.selectedIndex !== initialIndex) setInitial(sel.value);
    }
    setHydrated(true);
  }, []);
  if (!hydrated) {
    const { locale: _l, ...rest } = props;
    return (
      <div ref={host} className="contents">
        <Select {...rest} />
      </div>
    );
  }
  return <ComboboxInput {...props} defaultValue={initial ?? props.defaultValue} />;
}

function ComboboxInput({ name, options, defaultValue, label, placeholder, help, required, disabled, locale, id, style }: ComboboxProps) {
  const uid = useId();
  const inputId = `${uid}-input`;
  const listId = `${uid}-list`;
  const helpId = nonEmpty(help) ? `${uid}-help` : undefined;
  const optId = (i: number) => `${uid}-opt-${i}`;
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? '';
  const start = typeof defaultValue === 'string' && options.some((o) => o.value === defaultValue) ? defaultValue : '';

  const [value, setValue] = useState(start);
  const [text, setText] = useState(() => labelOf(start));
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => (query === null ? options : filterOptions(options, query)), [options, query]);

  useEffect(() => {
    if (open && active >= 0) document.getElementById(optId(active))?.scrollIntoView?.({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  const show = (all: boolean) => {
    if (disabled) return;
    if (all) setQuery(null);
    setOpen(true);
    const list = all ? options : matches;
    const sel = list.findIndex((o) => o.value === value);
    setActive(sel >= 0 ? sel : list.length ? 0 : -1);
  };
  const choose = (o: ControlOption) => {
    setValue(o.value);
    setText(o.label);
    setQuery(null);
    setOpen(false);
    setActive(-1);
  };
  const revert = () => {
    setText(labelOf(value));
    setQuery(null);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return show(query === null);
      if (!matches.length) return;
      setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % matches.length : (a - 1 + matches.length) % matches.length));
    } else if (e.key === 'Enter') {
      if (open && matches[active]) {
        e.preventDefault();
        choose(matches[active]);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        revert();
      } else if (text) {
        e.preventDefault();
        setValue('');
        setText('');
      }
    }
  };
  const onBlur = () => {
    if (!text.trim()) {
      setValue('');
      setText('');
      setQuery(null);
      setOpen(false);
      return;
    }
    const exact = options.find((o) => foldSearch(o.label) === foldSearch(text.trim()));
    if (exact) choose(exact);
    else revert();
  };

  return (
    <Field id={id} style={style}>
      <Label htmlFor={inputId} text={label} required={required} />
      <div className={COMBOBOX_BOX}>
        <input
          ref={input}
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 && matches[active] ? optId(active) : undefined}
          aria-label={fallbackLabel(label, placeholder, name)}
          aria-describedby={helpId}
          aria-required={required || undefined}
          autoComplete="off"
          value={text}
          placeholder={nonEmpty(placeholder)}
          disabled={disabled || undefined}
          className={cn(CONTROL, INPUT_H, COMBOBOX_INPUT)}
          onChange={(e) => {
            setText(e.target.value);
            setQuery(e.target.value);
            setOpen(true);
            setActive(filterOptions(options, e.target.value).length ? 0 : -1);
          }}
          onKeyDown={onKeyDown}
          onClick={() => (open ? undefined : show(true))}
          onBlur={onBlur}
        />
        <ChevronDownIcon className={COMBOBOX_CHEVRON} aria-hidden="true" />
        <ul id={listId} role="listbox" aria-label={nonEmpty(label) ?? fallbackLabel(label, placeholder, name)} hidden={!open} className={COMBOBOX_LIST}>
          {matches.map((o, i) => (
            <li
              key={o.value}
              id={optId(i)}
              role="option"
              aria-selected={o.value === value}
              data-active={i === active ? '' : undefined}
              className={COMBOBOX_OPTION}
              // Keep focus in the input; the click then chooses.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                choose(o);
                input.current?.focus();
              }}
            >
              {o.label}
            </li>
          ))}
          {!matches.length ? <li role="option" aria-disabled="true" aria-selected={false} className={COMBOBOX_EMPTY}>{NO_MATCH[locale ?? ''] ?? NO_MATCH['en-US']}</li> : null}
        </ul>
      </div>
      <input type="hidden" name={name} value={value} />
      <Help id={helpId} text={help} />
    </Field>
  );
}
