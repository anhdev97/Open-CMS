'use client';

// Column widths of Columns: a preset strip and a per-column editor (`2fr`, `auto` or a length), per breakpoint.
// Shared by the block builder (up to 12 columns) and the page builder's library Columns block (`max` 6).
import { PlusIcon, XIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { isTrack, type Responsive, type Track } from '@opencloudcms/schema';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { FieldRow, styleText, useStyleValue } from './shared';

export const TRACK_PRESETS: readonly { name: string; tracks: Track[] }[] = [
  { name: '1', tracks: ['1fr'] },
  { name: '1:1', tracks: ['1fr', '1fr'] },
  { name: '1:2', tracks: ['1fr', '2fr'] },
  { name: '2:1', tracks: ['2fr', '1fr'] },
  { name: '1:1:1', tracks: ['1fr', '1fr', '1fr'] },
  { name: '1:2:1', tracks: ['1fr', '2fr', '1fr'] },
  { name: '1:1:1:1', tracks: ['1fr', '1fr', '1fr', '1fr'] },
  { name: 'auto|1fr|auto', tracks: ['auto', '1fr', 'auto'] },
  { name: '1fr auto', tracks: ['1fr', 'auto'] },
];

const same = (a: Track[] | undefined, b: Track[]) => !!a && a.length === b.length && a.every((x, i) => x === b[i]);

/** Relative width of a track in a preset drawing (`auto` and lengths drawn narrow). */
const grow = (t: Track) => (/^\d+fr$/.test(t) ? Number.parseInt(t, 10) * 2 : 1);

/** A typed track: a bare number means `<n>fr`. */
const parseTrack = (s: string): Track => (/^\d+$/.test(s) ? `${s}fr` : s);

export interface TrackFieldProps {
  label: string;
  value: Responsive<Track[]> | undefined;
  onChange: (v: Responsive<Track[]> | undefined) => void;
  /** Most tracks per breakpoint (12 in composed Columns, 6 in the library block). */
  max?: number;
  readOnly?: boolean;
}

export function TrackField({ label, value, onChange, max = 12, readOnly }: TrackFieldProps) {
  const id = useId();
  const sv = useStyleValue<Track[]>(value, onChange as never);
  const tracks = Array.isArray(sv.shown) ? sv.shown : [];
  const inherited = sv.inheritedFrom !== null;
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [bad, setBad] = useState<number | null>(null);

  const edit = (i: number, text: string) => {
    setDrafts((d) => ({ ...d, [i]: text }));
    const t = parseTrack(text.trim());
    if (!isTrack(t)) return setBad(i);
    setBad(null);
    sv.set(tracks.map((x, j) => (j === i ? t : x)));
  };
  const remove = (i: number) => {
    setDrafts({});
    setBad(null);
    sv.set(tracks.filter((_, j) => j !== i));
  };

  return (
    <FieldRow id={id} label={label} sv={sv} readOnly={readOnly} error={bad !== null ? styleText('tracks.invalid') : null}>
      <div role="group" aria-label={styleText('tracks.presets')} className="flex flex-wrap gap-1">
        {TRACK_PRESETS.filter((p) => p.tracks.length <= max).map((p) => (
          <button
            key={p.name}
            type="button"
            data-preset={p.name}
            title={p.name}
            aria-label={p.name}
            aria-pressed={same(tracks, p.tracks)}
            disabled={readOnly}
            className="flex h-6 w-11 gap-px rounded border border-border p-0.5 hover:border-primary aria-pressed:border-primary aria-pressed:ring-1 aria-pressed:ring-primary disabled:opacity-50"
            onClick={() => {
              setDrafts({});
              setBad(null);
              sv.set([...p.tracks]);
            }}
          >
            {p.tracks.map((t, i) => (
              <span key={i} className="rounded-[2px] bg-muted-foreground/40" style={{ flexGrow: grow(t) }} />
            ))}
          </button>
        ))}
      </div>
      <ol className={`space-y-1 ${inherited ? 'text-muted-foreground' : ''}`}>
        {tracks.map((t, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <span className="w-14 shrink-0 text-xs text-muted-foreground">{styleText('tracks.column', { n: i + 1 })}</span>
            <Input
              id={i === 0 ? id : undefined}
              data-track={i}
              aria-label={styleText('tracks.column', { n: i + 1 })}
              aria-invalid={bad === i || undefined}
              className={`h-8 font-mono text-xs ${inherited ? 'text-muted-foreground' : ''}`}
              value={drafts[i] ?? t}
              disabled={readOnly}
              onChange={(e) => edit(i, e.target.value)}
              onBlur={() => setDrafts(({ [i]: _, ...rest }) => rest)}
            />
            <Button type="button" variant="ghost" size="icon-sm" className="size-7" aria-label={styleText('tracks.remove')} disabled={readOnly || tracks.length <= 1} onClick={() => remove(i)}>
              <XIcon aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ol>
      <Button type="button" data-add-track variant="outline" size="sm" className="h-7" disabled={readOnly || tracks.length >= max} onClick={() => sv.set([...tracks, '1fr'])}>
        <PlusIcon aria-hidden="true" />
        {styleText('tracks.add')}
      </Button>
    </FieldRow>
  );
}
