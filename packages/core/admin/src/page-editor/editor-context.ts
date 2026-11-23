'use client';

import { createContext, useContext } from 'react';
import type { Locale } from '@opencloudcms/schema';
import type { ResolvedItem } from './field-logic';

/** What the custom fields of the page editor need to know about the page being edited. */
export interface EditorInfo {
  documentId: string;
  /** Locale being edited (entry search, page links). */
  locale: Locale;
  defaultLocale: Locale;
  readOnly: boolean;
}

export const EditorInfoContext = createContext<EditorInfo>({ documentId: '', locale: 'en-US', defaultLocale: 'en-US', readOnly: true });

export const useEditorInfo = () => useContext(EditorInfoContext);

/** Resolved data-field values of the canvas, by block id (see `previewProps`). */
export const ResolvedContext = createContext<ReadonlyMap<string, ResolvedItem>>(new Map());
