// Shared pieces of the style fields: breakpoint labels, the responsive value at the edited breakpoint, and the field
// row (label, "from Mobile" note, reset button, error).
import { RotateCcwIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { setAt, valueAt, type Breakpoint, type Responsive } from '@opencloudcms/schema';
import { Button } from '../../components/ui/button';
import { Label } from '../../components/ui/label';
import { t } from '../../i18n';
import { useBreakpoint } from './breakpoint';

const BP_KEY: Record<Breakpoint, string> = { base: 'mobile', md: 'tablet', lg: 'desktop' };
export const bpLabel = (bp: Breakpoint) => t(`blockBuilder.style.bp.${BP_KEY[bp]}`);
export const styleText = (key: string, vars?: Record<string, string | number>) => t(`blockBuilder.style.${key}`, vars);

/** A `{ base }`-only responsive value is stored plain (`'8'`, not `{ base: '8' }`). */
export function compact<T>(v: Responsive<T> | undefined): Responsive<T> | undefined {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const keys = Object.keys(v);
    if (keys.length === 1 && keys[0] === 'base') return (v as { base: T }).base;
  }
  return v;
}

export interface StyleValue<T> {
  bp: Breakpoint;
  /** Value in effect at the edited breakpoint (own or inherited). */
  shown: T | undefined;
  /** Breakpoint the shown value comes from, when it is inherited. */
  inheritedFrom: Breakpoint | null;
  own: boolean;
  set: (next: T) => void;
  reset: () => void;
}

/** The value edited at the current breakpoint; `responsive: false` edits a plain value. */
export function useStyleValue<T>(value: Responsive<T> | T | undefined, onChange: (v: never) => void, responsive = true): StyleValue<T> {
  const bp = useBreakpoint();
  const emit = onChange as (v: unknown) => void;
  if (!responsive) {
    const v = value as T | undefined;
    return { bp, shown: v, inheritedFrom: null, own: v !== undefined, set: emit, reset: () => emit(undefined) };
  }
  const r = value as Responsive<T> | undefined;
  const { value: shown, from } = valueAt(r, bp);
  return {
    bp,
    shown,
    inheritedFrom: from !== null && from !== bp ? from : null,
    own: from === bp,
    set: (next) => emit(compact(setAt(r, bp, next))),
    reset: () => emit(compact(setAt(r, bp, undefined))),
  };
}

/** Label, control, "from Mobile" note, reset and error of one style value. */
export function FieldRow({
  id, label, sv, readOnly, error, children,
}: { id?: string; label: string; sv: Pick<StyleValue<unknown>, 'own' | 'inheritedFrom' | 'reset'>; readOnly?: boolean; error?: string | null; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <Label htmlFor={id} className="text-xs font-medium">
          {label}
        </Label>
        <span className="flex items-center gap-1">
          {sv.inheritedFrom && <span className="text-[11px] text-muted-foreground">{styleText('from', { bp: bpLabel(sv.inheritedFrom) })}</span>}
          {sv.own && !readOnly && (
            <Button type="button" data-reset variant="ghost" size="icon-sm" className="size-6" title={styleText('reset')} aria-label={styleText('reset')} onClick={sv.reset}>
              <RotateCcwIcon aria-hidden="true" className="size-3.5" />
            </Button>
          )}
        </span>
      </div>
      {children}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
