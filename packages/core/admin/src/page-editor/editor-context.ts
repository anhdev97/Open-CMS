'use client';

import { createContext, useContext } from 'react';
import type { BlockRegistry } from '@opencloudcms/core/blocks';
import type { Locale, PageKind } from '@opencloudcms/schema';
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

/** The layout block item of a base page, resolved for the canvas (ids made unique, every region with its base blocks). */
export type BaseFrameItem = { type: string; props: Record<string, unknown> };

/**
 * The base page framing the page being edited (`useBasePage`). `none`: no base page (the page chose None, or it is a
 * base page itself); `missing`: the page uses the default base page and there is none; `invalid`: the base page cannot
 * be loaded or its root is not one layout block (the canvas shows the page alone with a warning).
 */
export interface BaseState {
  kind: PageKind;
  registry: BlockRegistry | null;
  /** Content locale of the page. */
  locale: Locale;
  /** Which base this state is for: `default`, a base document id, or null (none). */
  key: string | null;
  status: 'none' | 'loading' | 'missing' | 'invalid' | 'ok';
  frame: BaseFrameItem | null;
  /** Region names of the base's layout block, in order. */
  regions: string[];
}

export const BaseContext = createContext<BaseState>({ kind: 'page', registry: null, locale: 'en-US', key: null, status: 'none', frame: null, regions: [] });
