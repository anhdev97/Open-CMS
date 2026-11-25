'use client';

// The style of one element (`ComposedNode.style`), in collapsible sections chosen by `STYLE_SECTIONS` (spec table).
// `StyleField` is its Puck custom field: it shows a node's old padding as style until the first change migrates it,
// and edits a Box/Card's semantic `background` prop in the Colors section.
import { EyeOffIcon } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { createUsePuck, useGetPuck, type CustomFieldRender } from '@puckeditor/core';
import {
  BORDER_SIDES, BORDER_WIDTH_TOKENS, BREAKPOINTS, RADIUS_TOKENS, STYLE_COLOR_TOKENS,
  type ComposedElement, type NodeStyle, type Responsive, type Sides, type ThemeDefinition,
} from '@opencloudcms/schema';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { useBuilder } from '../context';
import { STYLE_SECTIONS, type StyleSection } from '../element-config';
import { ColorField, LengthField, ResponsiveSelect, SidesField, Swatch } from './fields';
import { hasLegacyProps, migrateLegacyProps } from './migrate';
import { FieldRow, bpLabel, styleText, useStyleValue } from './shared';
import { useTheme } from './theme-context';

const PX_RE = /^\d+(?:\.\d+)?px$/;
const pxOr = (tokens: readonly string[]) => (v: string) => tokens.includes(v) || (PX_RE.test(v) && Number.parseFloat(v) <= 10000);
/** Padding a Box/Card renders without a padding prop or style padding (`PY['8']` / `P['6']` in blocks/src/ui/tokens.ts). */
export const PADDING_DEFAULTS: Partial<Record<ComposedElement, Sides>> = {
  Box: { t: '8', b: '8' },
  Card: { t: '6', r: '6', b: '6', l: '6' },
};

const spanOptions = () => [
  ...Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) })),
  { value: 'full', label: styleText('fullWidth') },
];

export interface StylePanelProps {
  el: ComposedElement;
  value: NodeStyle | undefined;
  onChange: (v: NodeStyle | undefined) => void;
  theme: ThemeDefinition | null;
  /** Element type of the parent: `span` is shown inside Columns and Grid only. */
  parent?: string;
  readOnly?: boolean;
  /** Box/Card semantic `background` prop, shown next to the style background. */
  legacyBackground?: { value: string | undefined; onChange: (v: string | undefined) => void };
}

function Section({ id, children }: { id: StyleSection; children: ReactNode }) {
  return (
    <details open data-section={id} className="group border-t border-border pt-2">
      <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wide text-muted-foreground">{styleText(`sections.${id}`)}</summary>
      <div className="mt-2 space-y-3">{children}</div>
    </details>
  );
}

function ThemeBackground({ value, onChange, replaced, readOnly }: { value: string | undefined; onChange: (v: string | undefined) => void; replaced: boolean; readOnly?: boolean }) {
  const id = useId();
  const sv = useStyleValue<string>(value, onChange as never, false);
  return (
    <FieldRow id={id} label={styleText('fields.themeBackground')} sv={sv} readOnly={readOnly}>
      <Select value={value ?? ''} disabled={readOnly} onValueChange={onChange}>
        <SelectTrigger id={id} size="sm" className="w-full">
          <SelectValue placeholder={styleText('default')}>
            <span className="flex items-center gap-1.5">
              <Swatch token={value} />
              {value}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {STYLE_COLOR_TOKENS.map((c) => (
            <SelectItem key={c} value={c}>
              <Swatch token={c} />
              {c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {replaced && value && <p className="text-xs text-muted-foreground">{styleText('replacedByBackground')}</p>}
    </FieldRow>
  );
}

function Toggle({ on, onClick, children, readOnly, ...data }: { on: boolean; onClick: () => void; children: ReactNode; readOnly?: boolean } & Record<`data-${string}`, string>) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={readOnly}
      onClick={onClick}
      className="inline-flex h-7 items-center gap-1 rounded-md border border-input px-2 text-xs hover:bg-accent aria-pressed:border-primary aria-pressed:bg-primary/10 disabled:opacity-50"
      {...data}
    >
      {children}
    </button>
  );
}

export function StylePanel({ el, value, onChange, theme, parent, readOnly, legacyBackground }: StylePanelProps) {
  const s = value ?? {};
  const put = <K extends keyof NodeStyle>(key: K, v: NodeStyle[K] | undefined) => {
    const next: NodeStyle = { ...s };
    if (v === undefined) delete next[key];
    else next[key] = v;
    onChange(Object.keys(next).length ? next : undefined);
  };
  const on = <K extends keyof NodeStyle>(key: K) => (v: unknown) => put(key, v as NodeStyle[K]);
  const f = (k: string) => styleText(`fields.${k}`);
  const common = { readOnly };

  const margin = (inner?: ReactNode) => <SidesField label={f('margin')} value={s.margin} onChange={on('margin')} negative auto inner={inner} {...common} />;
  const sections: Partial<Record<StyleSection, () => ReactNode>> = {
    spacing: () => margin(<SidesField label={f('padding')} value={s.padding} onChange={on('padding')} defaults={PADDING_DEFAULTS[el]} {...common} />),
    margin: () => margin(),
    size: () => (
      <>
        <LengthField label={f('width')} value={s.width} onChange={on('width')} auto {...common} />
        <LengthField label={f('height')} value={s.height} onChange={on('height')} auto {...common} />
        <LengthField label={f('minHeight')} value={s.minHeight} onChange={on('minHeight')} {...common} />
      </>
    ),
    maxWidth: () => <LengthField label={f('maxWidth')} value={s.maxWidth} onChange={on('maxWidth')} {...common} />,
    colors: () => (
      <>
        {legacyBackground && <ThemeBackground {...legacyBackground} replaced={s.background !== undefined} readOnly={readOnly} />}
        <ColorField label={f('background')} value={s.background} onChange={on('background')} theme={theme} {...common} />
        <ColorField label={f('color')} value={s.color} onChange={on('color')} theme={theme} {...common} />
        <LengthField label={f('borderWidth')} value={s.borderWidth} onChange={on('borderWidth')} responsive={false} tokens={BORDER_WIDTH_TOKENS} units={['px']} validate={pxOr(BORDER_WIDTH_TOKENS)} {...common} />
        {s.borderWidth !== undefined && (
          <>
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label={f('borderSides')}>
              {BORDER_SIDES.map((side) => {
                const list = s.borderSides ?? [...BORDER_SIDES];
                const active = list.includes(side);
                const next = active ? list.filter((x) => x !== side) : BORDER_SIDES.filter((x) => x === side || list.includes(x));
                return (
                  <Toggle key={side} data-border-side={side} on={active} readOnly={readOnly} onClick={() => put('borderSides', next.length === 4 ? undefined : next)}>
                    {styleText(`sides.${side}`)}
                  </Toggle>
                );
              })}
            </div>
            <ColorField label={f('borderColor')} value={s.borderColor} onChange={on('borderColor')} theme={theme} {...common} />
          </>
        )}
        <LengthField label={f('radius')} value={s.radius} onChange={on('radius')} responsive={false} tokens={RADIUS_TOKENS} units={['px']} validate={pxOr(RADIUS_TOKENS)} {...common} />
      </>
    ),
    textColor: () => <ColorField label={f('color')} value={s.color} onChange={on('color')} theme={theme} {...common} />,
    visibility: () => (
      <div className="flex flex-wrap gap-1" role="group" aria-label={styleText('hideOn')}>
        {BREAKPOINTS.map((bp) => {
          const hidden = s.hidden?.[bp] === true;
          return (
            <Toggle
              key={bp}
              data-hide={bp}
              on={hidden}
              readOnly={readOnly}
              onClick={() => {
                const next = { ...(s.hidden ?? {}) };
                if (hidden) delete next[bp];
                else next[bp] = true;
                put('hidden', Object.keys(next).length ? next : undefined);
              }}
            >
              <EyeOffIcon aria-hidden="true" className="size-3.5" />
              {styleText('hide', { bp: bpLabel(bp) })}
            </Toggle>
          );
        })}
      </div>
    ),
    span: () => (
      <ResponsiveSelect
        label={f('span')}
        value={toStrings(s.span)}
        options={spanOptions()}
        onChange={(v) => put('span', fromStrings(v))}
        {...common}
      />
    ),
  };

  const shown = STYLE_SECTIONS[el].filter((id) => id !== 'layout' && (id !== 'span' || parent === 'Columns' || parent === 'Grid'));
  return (
    <div className="space-y-2">
      {shown.map((id) => (
        <Section key={id} id={id}>
          {sections[id]?.()}
        </Section>
      ))}
    </div>
  );
}

type Span = number | 'full';
const toStrings = (v: Responsive<Span> | undefined): Responsive<string> | undefined => {
  if (v === undefined) return undefined;
  if (typeof v !== 'object') return String(v);
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, String(x)]));
};
const fromStrings = (v: Responsive<string> | undefined): Responsive<Span> | undefined => {
  const one = (x: string): Span => (x === 'full' ? 'full' : Number(x));
  if (v === undefined) return undefined;
  if (typeof v !== 'object') return one(v);
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, one(x as string)])) as Responsive<Span>;
};

const usePuck = createUsePuck();

/** Puck custom field `style` of element `metadata.el`. */
export const StyleField: CustomFieldRender<unknown> = ({ field, value, onChange, readOnly }) => {
  const el = (field.metadata as { el: ComposedElement }).el;
  const m = useBuilder();
  const { theme } = useTheme();
  const getPuck = useGetPuck();
  const item = usePuck((s) => s.selectedItem);
  const parent = usePuck((s) => (s.selectedItem ? s.getParentById(String(s.selectedItem.props.id))?.type : undefined));
  const props = (item?.props ?? {}) as Record<string, unknown>;
  const style = value as NodeStyle | undefined;
  const shown = hasLegacyProps(el, props) ? migrateLegacyProps(el, props, style).style : style;

  /** Writes a node prop next to `style` (Puck replaces the item, then runs `resolveData` as for a field change). */
  const writeProp = (name: string, v: unknown) => {
    const api = getPuck();
    const sel = api.selectedItem;
    const at = sel ? api.getSelectorForId(String(sel.props.id)) : undefined;
    if (!sel || !at) return;
    api.dispatch({ type: 'replace', destinationIndex: at.index, destinationZone: at.zone, data: { ...sel, props: { ...sel.props, [name]: v } } });
    api.resolveDataById(String(sel.props.id), 'replace');
  };

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{styleText('title')}</legend>
      <StylePanel
        el={el}
        value={shown}
        onChange={(v) => onChange(v)}
        theme={theme}
        parent={parent}
        readOnly={readOnly || m.readOnly}
        legacyBackground={el === 'Box' || el === 'Card' ? { value: props.background as string | undefined, onChange: (v) => writeProp('background', v) } : undefined}
      />
    </fieldset>
  );
};
