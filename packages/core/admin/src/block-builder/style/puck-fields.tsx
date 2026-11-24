'use client';

// Puck custom-field adapters of the style fields (label from the Puck field, options in `metadata`).
import type { CustomFieldRender } from '@puckeditor/core';
import type { Length, Responsive, Track } from '@opencloudcms/schema';
import { fieldLabel } from '../../page-editor/FieldShell';
import { LengthField, ResponsiveSelect, TrackField, type SelectOption } from './fields';

/** Column tracks; `metadata.blockField.max` caps the count (as the page builder's `b.tracks` field passes it). */
export const TracksPuckField: CustomFieldRender<unknown> = ({ field, name, value, onChange, readOnly }) => {
  const max = (field.metadata?.blockField as { max?: number } | undefined)?.max ?? 12;
  return <TrackField label={fieldLabel(field, name)} value={value as Responsive<Track[]> | undefined} onChange={onChange} max={max} readOnly={readOnly} />;
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
