'use client';

// Box-model widget: one ring of four side inputs (margin outside, padding inside via `inner`). Each side is a spacing
// token or a length; a side not set at the edited breakpoint shows the inherited value as its placeholder.
import { Link2Icon, Link2OffIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { BORDER_SIDES, BREAKPOINTS, isLength, resolveResponsive, type Breakpoint, type Responsive, type Sides } from '@opencloudcms/schema';
import { Button } from '../../components/ui/button';
import { useBreakpoint } from './breakpoint';
import { compact, styleText } from './shared';

type Side = (typeof BORDER_SIDES)[number];

/** Value of one side in effect at `bp`, and whether it is set at `bp` itself. */
function sideAt(v: Responsive<Sides> | undefined, bp: Breakpoint, side: Side): { value: string | undefined; own: boolean } {
  const r = resolveResponsive(v);
  for (let i = BREAKPOINTS.indexOf(bp); i >= 0; i--) {
    const x = r[BREAKPOINTS[i]!]?.[side];
    if (x !== undefined) return { value: x, own: i === BREAKPOINTS.indexOf(bp) };
  }
  return { value: undefined, own: false };
}

/** `v` with `sides` set (a value) or cleared (`undefined`) at `bp`; empty breakpoints are dropped. */
export function setSides(v: Responsive<Sides> | undefined, bp: Breakpoint, sides: Partial<Record<Side, string | undefined>>): Responsive<Sides> | undefined {
  const r: Partial<Record<Breakpoint, Sides>> = { ...resolveResponsive(v) };
  const at: Sides = { ...(r[bp] ?? {}) };
  for (const [s, x] of Object.entries(sides) as [Side, string | undefined][]) {
    if (x === undefined) delete at[s];
    else at[s] = x;
  }
  if (Object.keys(at).length) r[bp] = at;
  else delete r[bp];
  return Object.keys(r).length ? compact(r) : undefined;
}

const POS: Record<Side, string> = { t: 'col-start-2 row-start-1', r: 'col-start-3 row-start-2', b: 'col-start-2 row-start-3', l: 'col-start-1 row-start-2' };

export interface SidesFieldProps {
  label: string;
  value: Responsive<Sides> | undefined;
  onChange: (v: Responsive<Sides> | undefined) => void;
  /** Margin: negative lengths and `auto` allowed. */
  negative?: boolean;
  auto?: boolean;
  /** Drawn in the middle of the ring (the padding ring inside the margin ring). */
  inner?: ReactNode;
  readOnly?: boolean;
}

export function SidesField({ label, value, onChange, negative, auto, inner, readOnly }: SidesFieldProps) {
  const bp = useBreakpoint();
  const [linked, setLinked] = useState(false);
  const [drafts, setDrafts] = useState<Partial<Record<Side, string>>>({});
  const [bad, setBad] = useState<Side | null>(null);

  const write = (side: Side, text: string) => {
    setDrafts((d) => ({ ...d, [side]: text }));
    const s = text.trim();
    const targets = linked ? BORDER_SIDES : [side];
    if (!s) {
      setBad(null);
      return onChange(setSides(value, bp, Object.fromEntries(targets.map((x) => [x, undefined]))));
    }
    if (!isLength(s, { negative, auto })) return setBad(side);
    setBad(null);
    if (linked) setDrafts({});
    onChange(setSides(value, bp, Object.fromEntries(targets.map((x) => [x, s]))));
  };

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[3.5rem_1fr_3.5rem] grid-rows-[auto_minmax(2.25rem,auto)_auto] items-center gap-1 rounded-md border border-dashed border-border p-1">
        <span className="col-start-1 row-start-1 self-start text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
        {BORDER_SIDES.map((side) => {
          const at = sideAt(value, bp, side);
          const shown = drafts[side] ?? (at.own ? at.value : '');
          return (
            <input
              key={side}
              data-side={side}
              aria-label={`${label} ${styleText(`sides.${side}`)}`}
              aria-invalid={bad === side || undefined}
              className={`${POS[side]} h-7 w-full min-w-0 justify-self-center rounded border border-input bg-background px-1 text-center text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive`}
              placeholder={at.own ? '' : (at.value ?? '–')}
              value={shown}
              disabled={readOnly}
              onChange={(e) => write(side, e.target.value)}
              onBlur={() => setDrafts((d) => ({ ...d, [side]: undefined }))}
            />
          );
        })}
        <Button
          type="button"
          data-link
          variant={linked ? 'secondary' : 'ghost'}
          size="icon-sm"
          className="col-start-3 row-start-1 size-6 justify-self-end"
          aria-pressed={linked}
          title={styleText('link')}
          aria-label={styleText('link')}
          disabled={readOnly}
          onClick={() => setLinked((l) => !l)}
        >
          {linked ? <Link2Icon aria-hidden="true" /> : <Link2OffIcon aria-hidden="true" />}
        </Button>
        <div className="col-start-2 row-start-2 min-w-0">{inner}</div>
      </div>
      {bad && (
        <p role="alert" className="text-xs text-destructive">
          {styleText('invalidLength')}
        </p>
      )}
    </div>
  );
}
