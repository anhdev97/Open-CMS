'use client';

// Style value fields of the builders: a token select first, then "Custom" (number + unit, or hex with a picker).
// Values are written at the edited breakpoint (mobile-first) and only when they pass the schema validators.
import { TriangleAlertIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  STYLE_COLOR_TOKENS, STYLE_SPACING_TOKENS, activeColors, isColorValue, isLength,
  type ColorValue, type Length, type Responsive, type ThemeDefinition,
} from '@opencloudcms/schema';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '../../components/ui/select';
import { FieldRow, styleText, useStyleValue } from './shared';

export { SidesField } from './SidesField';
export { TrackField } from './TrackField';

const CUSTOM = '__custom';
export const UNITS = ['px', 'rem', 'em', '%', 'vw', 'vh'] as const;
const NUM_RE = /^-?\d+(?:\.\d+)?$/;
const SPLIT_RE = /^(-?\d+(?:\.\d+)?)(px|rem|em|%|vw|vh)$/;
const muted = 'text-muted-foreground';

// Literal classes so Tailwind sees them (the theme's semantic colour tokens).
export const SWATCH: Record<string, string> = {
  primary: 'bg-primary', secondary: 'bg-secondary', muted: 'bg-muted', accent: 'bg-accent',
  background: 'bg-background', foreground: 'bg-foreground', destructive: 'bg-destructive',
};

export function Swatch({ token, hex }: { token?: string; hex?: string }) {
  const cls = token ? SWATCH[token] : '';
  return <span aria-hidden="true" className={`inline-block size-3 shrink-0 rounded-sm border border-border ${cls ?? ''}`} style={hex && isColorValue(hex) ? { background: hex } : undefined} />;
}

/** Shown text of a select: muted (with `data-inherited`) when the value comes from a smaller breakpoint. */
function Shown({ inherited, children }: { inherited: boolean; children: ReactNode }) {
  return inherited ? (
    <span data-inherited className={`flex items-center gap-1.5 ${muted}`}>
      {children}
    </span>
  ) : (
    <span className="flex items-center gap-1.5">{children}</span>
  );
}

export interface LengthInputProps {
  id: string;
  value: string | undefined;
  onChange: (v: string) => void;
  /** Token choices (default: spacing tokens); `auto` is added when allowed. */
  tokens?: readonly string[];
  auto?: boolean;
  negative?: boolean;
  units?: readonly string[];
  /** Replaces the default `isLength` check of a custom value. */
  validate?: (v: string) => boolean;
  /** The value is inherited: drawn muted. */
  inherited?: boolean;
  readOnly?: boolean;
  onError?: (error: string | null) => void;
}

/** Token select + "Custom" (a number, or a number with a unit, and a unit select). */
export function LengthInput({
  id, value, onChange, tokens = STYLE_SPACING_TOKENS, auto, negative, units = UNITS, validate, inherited = false, readOnly, onError,
}: LengthInputProps) {
  const choices = auto ? [...tokens, 'auto'] : [...tokens];
  const isToken = value !== undefined && choices.includes(value);
  const split = value ? SPLIT_RE.exec(value) : null;
  const [customMode, setCustomMode] = useState(false);
  const [text, setText] = useState(split ? split[1]! : value && !isToken ? value : '');
  const [unit, setUnit] = useState<string>(split && units.includes(split[2]!) ? split[2]! : units[0]!);
  const last = useRef(value);
  useEffect(() => {
    if (value === last.current) return;
    last.current = value;
    const m = value ? SPLIT_RE.exec(value) : null;
    setText(m ? m[1]! : value && !choices.includes(value) ? value : '');
    if (m && units.includes(m[2]!)) setUnit(m[2]!);
    if (value !== undefined && choices.includes(value)) setCustomMode(false);
    onError?.(null);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const custom = customMode || (value !== undefined && !isToken);
  const ok = validate ?? ((v: string) => isLength(v, { negative, auto }));

  const commit = (txt: string, u: string) => {
    setText(txt);
    const s = txt.trim();
    if (!s) return onError?.(null);
    const candidate = NUM_RE.test(s) ? `${s}${u}` : s;
    if (!ok(candidate)) return onError?.(styleText('invalidLength'));
    onError?.(null);
    last.current = candidate;
    onChange(candidate);
  };

  return (
    <div className="flex gap-1.5">
      <Select
        value={custom ? CUSTOM : (value ?? '')}
        disabled={readOnly}
        onValueChange={(v) => {
          if (v === CUSTOM) return setCustomMode(true);
          setCustomMode(false);
          onError?.(null);
          last.current = v;
          onChange(v);
        }}
      >
        <SelectTrigger id={id} size="sm" className={custom ? 'w-24 shrink-0' : 'w-full'}>
          <SelectValue placeholder={styleText('default')}>
            <Shown inherited={inherited}>{custom ? styleText('custom') : value === 'auto' ? styleText('auto') : value}</Shown>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {choices.map((c) => (
            <SelectItem key={c} value={c}>
              {c === 'auto' ? styleText('auto') : c}
            </SelectItem>
          ))}
          <SelectItem value={CUSTOM}>{styleText('custom')}</SelectItem>
        </SelectContent>
      </Select>
      {custom && (
        <>
          <Input
            data-custom
            aria-label={styleText('customValue')}
            inputMode="decimal"
            className={`h-8 min-w-0 flex-1 ${inherited ? muted : ''}`}
            value={text}
            disabled={readOnly}
            onChange={(e) => commit(e.target.value, unit)}
          />
          {units.length > 1 && (
            <Select
              value={unit}
              disabled={readOnly}
              onValueChange={(u) => {
                setUnit(u);
                if (NUM_RE.test(text.trim())) commit(text, u);
              }}
            >
              <SelectTrigger size="sm" aria-label={styleText('unit')} className="w-16 shrink-0">
                <SelectValue>{unit}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {units.map((u) => (
                  <SelectItem key={u} value={u}>
                    {u}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </>
      )}
    </div>
  );
}

export interface LengthFieldProps extends Omit<LengthInputProps, 'id' | 'value' | 'onChange' | 'inherited' | 'onError'> {
  label: string;
  value: Responsive<Length> | undefined;
  onChange: (v: Responsive<Length> | undefined) => void;
  /** `false`: a plain value, not per breakpoint (e.g. a gap). */
  responsive?: boolean;
}

export function LengthField({ label, value, onChange, responsive = true, readOnly, ...input }: LengthFieldProps) {
  const id = useId();
  const sv = useStyleValue<Length>(value, onChange as never, responsive);
  const [error, setError] = useState<string | null>(null);
  return (
    <FieldRow id={id} label={label} sv={sv} readOnly={readOnly} error={error}>
      <LengthInput id={id} value={sv.shown} inherited={sv.inheritedFrom !== null} readOnly={readOnly} onChange={sv.set} onError={setError} {...input} />
    </FieldRow>
  );
}

export interface ColorFieldProps {
  label: string;
  value: ColorValue | undefined;
  onChange: (v: ColorValue | undefined) => void;
  /** The project theme: its colours are offered as brand swatches (none when null). */
  theme: ThemeDefinition | null;
  readOnly?: boolean;
}

/** Semantic swatches, then brand swatches of the theme, then a custom hex (text + picker). */
export function ColorField({ label, value, onChange, theme, readOnly }: ColorFieldProps) {
  const id = useId();
  const sv = useStyleValue<ColorValue>(value, onChange as never, false);
  const brand = theme ? activeColors(theme) : {};
  const brandNames = theme ? Object.keys(theme.colors) : [];
  const brandLabel = (n: string) => theme?.colors[n]?.label || n;
  const isTokenOrBrand = value !== undefined && ((STYLE_COLOR_TOKENS as readonly string[]).includes(value) || value.startsWith('brand:'));
  const [customMode, setCustomMode] = useState(false);
  const custom = customMode || (value !== undefined && !isTokenOrBrand);
  const [hex, setHex] = useState(value && !isTokenOrBrand ? value : '');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (value && !isTokenOrBrand && value !== hex) setHex(value);
    if (isTokenOrBrand) setCustomMode(false);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const missing = value?.startsWith('brand:') && !brandNames.includes(value.slice(6)) ? value.slice(6) : null;

  const writeHex = (v: string) => {
    setHex(v);
    if (!v.trim()) return setError(null);
    if (!/^#/.test(v) || !isColorValue(v)) return setError(styleText('invalidColor'));
    setError(null);
    onChange(v);
  };
  const shown = (v: string | undefined) => {
    if (!v) return null;
    if (custom) return <><Swatch hex={v} />{styleText('custom')}</>;
    if (v.startsWith('brand:')) return <><Swatch hex={brand[v.slice(6)]} />{brandLabel(v.slice(6))}</>;
    return <><Swatch token={v} />{v}</>;
  };

  return (
    <FieldRow id={id} label={label} sv={sv} readOnly={readOnly} error={error}>
      <div className="flex gap-1.5">
        <Select
          value={custom ? CUSTOM : (value ?? '')}
          disabled={readOnly}
          onValueChange={(v) => {
            if (v === CUSTOM) return setCustomMode(true);
            setCustomMode(false);
            setError(null);
            onChange(v);
          }}
        >
          <SelectTrigger id={id} size="sm" className={custom ? 'w-28 shrink-0' : 'w-full'}>
            <SelectValue placeholder={styleText('default')}>
              <Shown inherited={false}>{shown(value) ?? (custom ? styleText('custom') : null)}</Shown>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>{styleText('semantic')}</SelectLabel>
              {STYLE_COLOR_TOKENS.map((c) => (
                <SelectItem key={c} value={c}>
                  <Swatch token={c} />
                  {c}
                </SelectItem>
              ))}
            </SelectGroup>
            {brandNames.length > 0 && (
              <SelectGroup>
                <SelectSeparator />
                <SelectLabel>{styleText('brand')}</SelectLabel>
                {brandNames.map((n) => (
                  <SelectItem key={n} value={`brand:${n}`}>
                    <Swatch hex={brand[n]} />
                    {brandLabel(n)}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
            <SelectSeparator />
            <SelectItem value={CUSTOM}>{styleText('custom')}</SelectItem>
          </SelectContent>
        </Select>
        {custom && (
          <>
            <input
              type="color"
              aria-label={styleText('picker')}
              className="h-8 w-9 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-0.5"
              value={/^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#000000'}
              disabled={readOnly}
              onChange={(e) => writeHex(e.target.value)}
            />
            <Input data-custom aria-label={styleText('hex')} className="h-8 min-w-0 flex-1 font-mono" value={hex} placeholder="#1e40af" disabled={readOnly} onChange={(e) => writeHex(e.target.value)} />
          </>
        )}
      </div>
      {missing && (
        <Badge data-missing-brand variant="outline" className="border-warning text-warning">
          <TriangleAlertIcon aria-hidden="true" />
          {styleText('missingBrand', { name: missing })}
        </Badge>
      )}
    </FieldRow>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

/** A select per breakpoint (Stack direction/align, Image aspect, column span). */
export function ResponsiveSelect({
  label, value, onChange, options, readOnly, responsive = true,
}: { label: string; value: Responsive<string> | undefined; onChange: (v: Responsive<string> | undefined) => void; options: readonly SelectOption[]; readOnly?: boolean; responsive?: boolean }) {
  const id = useId();
  const sv = useStyleValue<string>(value, onChange as never, responsive);
  const current = options.find((o) => o.value === sv.shown);
  return (
    <FieldRow id={id} label={label} sv={sv} readOnly={readOnly}>
      <Select value={sv.shown ?? ''} disabled={readOnly} onValueChange={sv.set}>
        <SelectTrigger id={id} size="sm" className="w-full">
          <SelectValue placeholder={styleText('default')}>
            <Shown inherited={sv.inheritedFrom !== null}>{current?.label ?? sv.shown}</Shown>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldRow>
  );
}
