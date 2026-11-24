'use client';

// Puck custom-field adapters of the style fields (label from the Puck field, options in `metadata`).
import { createUsePuck, type CustomFieldRender } from '@puckeditor/core';
import type { Length, Responsive, Track } from '@opencloudcms/schema';
import { fieldLabel } from '../../page-editor/FieldShell';
import { LengthField, ResponsiveSelect, TrackField, type SelectOption } from './fields';
import { tracksForCount } from './migrate';

const usePuck = createUsePuck();

/** Tracks shown for a Columns node: its own, else those of a legacy `count` (what the first change migrates to). */
export function shownTracks(tracks: unknown, count: unknown): Responsive<Track[]> | undefined {
  if (tracks !== undefined && tracks !== null) return tracks as Responsive<Track[]>;
  return count === undefined ? undefined : tracksForCount(count);
}

/** Column tracks of composed Columns; `metadata.blockField.max` caps the count. */
export const TracksPuckField: CustomFieldRender<unknown> = ({ field, name, value, onChange, readOnly }) => {
  const max = (field.metadata?.blockField as { max?: number } | undefined)?.max ?? 12;
  const count = usePuck((s) => (s.selectedItem?.props as Record<string, unknown> | undefined)?.count);
  return <TrackField label={fieldLabel(field, name)} value={shownTracks(value, count)} onChange={onChange} max={max} readOnly={readOnly} />;
};

/** A plain (not per-breakpoint) spacing token or length, e.g. a column gap. */
export const LengthPuckField: CustomFieldRender<unknown> = ({ field, name, value, onChange, readOnly }) => (
  <LengthField label={fieldLabel(field, name)} value={value as Length | undefined} onChange={onChange} responsive={false} readOnly={readOnly} />
);

/** A select per breakpoint over `metadata.options`. */
export const ResponsiveSelectPuckField: CustomFieldRender<unknown> = ({ field, name, value, onChange, readOnly }) => {
  const options = (field.metadata?.options ?? []) as SelectOption[];
  return <ResponsiveSelect label={fieldLabel(field, name)} value={value as Responsive<string> | undefined} onChange={onChange} options={options} readOnly={readOnly} />;
};
