'use client';

import { createContext, useContext } from 'react';
import type { ComposedBinding, ComposedBlockKind, ComposedField, ComposedNode } from '@opencloudcms/schema';
import type { DetailPaths, Entry } from '@opencloudcms/core/blocks';
import type { ContentTypeDefinition } from '../lib/types';
import type { BlockDraft } from './logic';
import type { BindScope } from './collection-list';

/** What the panels and custom fields of the builder read and change (outside Puck's data). */
export interface BuilderModel {
  draft: BlockDraft;
  setDraft: (update: (d: BlockDraft) => BlockDraft) => void;
  /** Content types of the project (core types hidden). */
  types: readonly ContentTypeDefinition[];
  /** The bound content type, when there is one and it exists. */
  type: ContentTypeDefinition | null;
  readOnly: boolean;
  /** The block was saved before: its name can no longer change. */
  nameLocked: boolean;
  /** Content locales of the site (for labels and empty text). */
  locales: readonly string[];
  /** Page-builder block names (for a Slot's `allow`). */
  pageBlocks: readonly string[];
  /** Adds a manual field. */
  addField: (name: string, field: ComposedField) => void;
  /** Elements of the canvas that read manual field `name` (bind or show-if). */
  fieldUsage: (name: string) => number;
  /** What the tree makes the block: `layout` (regions), `overlay` (Overlay root) or `block`. */
  kind: ComposedBlockKind;
  /** Valid `anchorId`s of the tree (scroll targets offered to Button actions). */
  anchors: readonly string[];
  /** Regions of the tree named `name`. */
  regionCount: (name: string) => number;
  /** What item `id`'s bindings read: its CollectionList's type, else the block binding's (default: the block's). */
  scope?: (id: string | null) => BindScope;
  /** Keys of the CollectionLists in the canvas, but item `exceptId`'s. */
  listKeys?: (exceptId: string) => string[];
}

export const BuilderContext = createContext<BuilderModel | null>(null);

export function useBuilder(): BuilderModel {
  const m = useContext(BuilderContext);
  if (!m) throw new Error('BuilderContext missing');
  return m;
}

/** What the canvas renders with: sample data, the content locale and the current spec parts. */
export interface CanvasModel {
  binding?: ComposedBinding;
  fields: Record<string, ComposedField>;
  tree: ComposedNode;
  /** Sample entry of the editable template (null while loading or unbound). */
  entry: Entry | null;
  /** Further samples of a collection, drawn read-only after the template. */
  repeats: readonly Entry[];
  /** Page content locale stamped as `_locale`. */
  locale: string;
  /** Preview values of the manual fields. */
  fieldValues: Record<string, unknown>;
  /** Samples of each CollectionList by key: the editable item's entry and the read-only repeats. */
  lists?: Record<string, ListSample>;
  /** Usable detail pages by apiId (stamped as `_detailPaths`, so `entryUrl` links like on the site). */
  detailPaths?: DetailPaths;
}

export interface ListSample {
  entry: Entry | null;
  repeats: readonly Entry[];
}

export const CanvasContext = createContext<CanvasModel>({ fields: {}, tree: { el: 'Box' }, entry: null, repeats: [], locale: 'en-US', fieldValues: {} });

/** Item shapes of the Puck data the canvas reads (mirrors `tree-puck`'s `PuckItem`). */
export interface CanvasItem {
  type: string;
  props: Record<string, unknown>;
}

/**
 * The selection of the block builder canvas (spec §3 "Canvas visibility"): what is selected, its ancestors, the items
 * of a container's slot, and a way to select an item. Provided inside Puck by `CanvasSelectionProvider`; the page
 * builder has none, so its canvas keeps the real behaviour.
 */
export interface CanvasSelectionModel {
  selectedId: string | null;
  /** Ids from the selected item up to the top level (empty without a selection). */
  path: readonly string[];
  /** Items of container `id`'s `children` slot. */
  children: (id: string) => readonly CanvasItem[];
  select: (id: string) => void;
}

export const CanvasSelection = createContext<CanvasSelectionModel>({ selectedId: null, path: [], children: () => [], select: () => {} });

/** What the selected item's bindings read (its CollectionList's type inside an item template, else the block's). */
export function useBindScope(): BindScope {
  const m = useBuilder();
  const { selectedId } = useContext(CanvasSelection);
  if (m.scope) return m.scope(selectedId);
  const b = m.draft.binding;
  return { inList: false, apiId: b?.apiId ?? '', type: m.type, ...(b?.urlPattern ? { urlPattern: b.urlPattern } : {}) };
}

/** "Show hover" of the style panel: the item drawn with its hover colours (or none). */
export interface HoverPreviewModel {
  id: string | null;
  set: (id: string | null) => void;
}

export const HoverPreview = createContext<HoverPreviewModel>({ id: null, set: () => {} });
