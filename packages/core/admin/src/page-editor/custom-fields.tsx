'use client';

// Custom field renderers of the page builder (`toPuckConfig` `customFields`): pickers and the library Columns tracks.
import type { CustomFieldRender } from '@puckeditor/core';
import type { CustomFieldRenderers } from '@opencloudcms/core/blocks';
import type { Responsive, Track } from '@opencloudcms/schema';
import { TrackField } from '../block-builder/style/fields';
import { EntriesField } from './EntriesField';
import { EntryField } from './EntryPicker';
import { fieldLabel } from './FieldShell';
import { ImageField } from './ImageField';
import { LinkField } from './LinkField';

/** A `b.tracks` value is `null` when unset (the block then uses its column count): undefined inside the field. */
export const pageTracks = {
  in: (v: unknown): Responsive<Track[]> | undefined => (v === null || v === undefined ? undefined : (v as Responsive<Track[]>)),
  out: (v: Responsive<Track[]> | undefined): Responsive<Track[]> | null => v ?? null,
};

/** `b.tracks` (library Columns): the builder's TrackField at the device toggle's breakpoint, `max` from the field. */
export const PageTracksPuckField: CustomFieldRender<Responsive<Track[]> | null> = ({ field, name, value, onChange, readOnly }) => {
  const max = (field.metadata?.blockField as { max?: number } | undefined)?.max ?? 6;
  return <TrackField label={fieldLabel(field, name)} value={pageTracks.in(value)} onChange={(v) => onChange(pageTracks.out(v))} max={max} readOnly={readOnly} />;
};

export const PAGE_CUSTOM_FIELDS = {
  entry: EntryField,
  entries: EntriesField,
  link: LinkField,
  image: ImageField,
  tracks: PageTracksPuckField,
} as unknown as CustomFieldRenderers;
