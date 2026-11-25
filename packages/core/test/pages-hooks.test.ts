import { describe, expect, it } from 'vitest';
import { validatePageLayout, type BlockManifest } from '@opencloudcms/schema';
import { createPageHooks } from '../src/pages/page.hooks';
import type { HookContext, PublishedDocument } from '../src/options';

const manifest: BlockManifest = [
  { name: 'Frame', version: 1, kind: 'layout' },
  { name: 'Heading', version: 1 },
  { name: 'Modal', version: 1, kind: 'overlay' },
];
const ctx = { apiId: 'opencloudcmsPage', locale: 'en-US', db: null as any } as HookContext;
const item = (type: string, props: Record<string, unknown> = {}) => ({ type, props: { id: `${type}-1`, ...props } });
const puck = (content: unknown[], rootProps: Record<string, unknown> = {}) => ({
  format: 'puck',
  formatVersion: 1,
  data: { root: { props: rootProps }, content },
});
const doc = (kind: string, translations: Record<string, Record<string, unknown>>, shared: Record<string, unknown> = {}): PublishedDocument => ({
  documentId: '00000000-0000-4000-8000-000000000001',
  shared: { kind, isDefault: false, layout: null, ...shared },
  translations,
});

async function publishError(d: PublishedDocument, m: BlockManifest | null = manifest, force = false) {
  try {
    await createPageHooks(m ?? undefined).beforePublish!(d, { ...ctx, force });
    return null;
  } catch (e: any) {
    return { status: e.getStatus(), ...(e.getResponse() as object) } as { status: number; code: string };
  }
}

describe('validatePageLayout', () => {
  it('accepts null, a base id, null base id and region modes', () => {
    expect(validatePageLayout(null)).toEqual({ ok: true });
    expect(validatePageLayout(undefined)).toEqual({ ok: true });
    expect(validatePageLayout({ baseId: null })).toEqual({ ok: true });
    // Absent baseId = the default base page, with or without region modes.
    expect(validatePageLayout({})).toEqual({ ok: true });
    expect(validatePageLayout({ regions: { header: 'replace' } })).toEqual({ ok: true });
    expect(validatePageLayout({ baseId: '00000000-0000-4000-8000-000000000001', regions: { header: 'hide', 'side-2': 'replace', footer: 'default' } })).toEqual({ ok: true });
  });

  it('rejects bad shapes, ids, region names and modes', () => {
    for (const bad of [[], 'x', { baseId: 'nope' }, { baseId: undefined }, { regions: { Header: 'hide' } }, { baseId: null, regions: [] }, { baseId: null, regions: { Header: 'hide' } }, { baseId: null, regions: { header: 'show' } }, { baseId: null, extra: 1 }]) {
      expect(validatePageLayout(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('page hooks', () => {
  it('beforeCreate defaults a null kind to page and rejects unknown kinds and isDefault writes', async () => {
    const h = createPageHooks(manifest);
    // Absent: left to the column default ('page'); explicit null: set (the column is not null).
    expect(await h.beforeCreate!({ title: 'x' }, ctx)).toEqual({ title: 'x' });
    expect(await h.beforeCreate!({ title: 'x', kind: null }, ctx)).toMatchObject({ kind: 'page' });
    expect(await h.beforeCreate!({ title: 'x', kind: 'base' }, ctx)).toMatchObject({ kind: 'base' });
    await expect(h.beforeCreate!({ kind: 'frame' }, ctx)).rejects.toMatchObject({ response: { code: 'invalid_kind' } });
    await expect(h.beforeCreate!({ isDefault: true }, ctx)).rejects.toMatchObject({ response: { code: 'managed_field' } });
    expect(await h.beforeCreate!({ title: 'x', isDefault: false }, ctx)).not.toHaveProperty('isDefault');
  });

  it('beforeCreate validates layout and refuses a layout on a base page', async () => {
    const h = createPageHooks(manifest);
    await expect(h.beforeCreate!({ layout: { baseId: 'x' } }, ctx)).rejects.toMatchObject({ response: { code: 'invalid_layout' } });
    await expect(h.beforeCreate!({ kind: 'base', layout: { baseId: null } }, ctx)).rejects.toMatchObject({ response: { code: 'invalid_layout' } });
    expect(await h.beforeCreate!({ layout: { baseId: null, regions: { header: 'hide' } } }, ctx)).toMatchObject({ layout: { baseId: null } });
    // No baseId = the default base page with region modes: no base lookup.
    expect(await h.beforeCreate!({ layout: { regions: { header: 'replace' } } }, ctx)).toMatchObject({ layout: { regions: { header: 'replace' } } });
    await expect(h.beforeCreate!({ kind: 'base', layout: { regions: {} } }, ctx)).rejects.toMatchObject({ response: { code: 'invalid_layout' } });
  });

  it('publishing a page requires a path in every translation', async () => {
    expect(await publishError(doc('page', { 'en-US': { path: '/a', content: puck([item('Heading')]) } }))).toBeNull();
    expect(await publishError(doc('page', { 'en-US': { path: '/a' }, 'vi-VN': { path: null } }))).toMatchObject({ status: 422, code: 'path_required' });
    expect(await publishError(doc('page', {}))).toMatchObject({ status: 422, code: 'path_required' });
    // Also without a manifest.
    expect(await publishError(doc('page', { 'en-US': { path: '' } }), null)).toMatchObject({ code: 'path_required' });
  });

  it('publishing a page with a layout block anywhere -> 422 layout_block_misplaced (force does not skip it)', async () => {
    expect(await publishError(doc('page', { 'en-US': { path: '/a', content: puck([item('Frame')]) } }))).toMatchObject({ status: 422, code: 'layout_block_misplaced' });
    const nested = puck([item('Heading', { items: [item('Frame')] })]);
    expect(await publishError(doc('page', { 'en-US': { path: '/a', content: nested } }))).toMatchObject({ code: 'layout_block_misplaced' });
    const inRoot = puck([], { region__header: [item('Frame')] });
    expect(await publishError(doc('page', { 'en-US': { path: '/a', content: inRoot } }), manifest, true)).toMatchObject({ code: 'layout_block_misplaced' });
    // Overlay blocks are fine in pages.
    expect(await publishError(doc('page', { 'en-US': { path: '/a', content: puck([item('Modal')]) } }))).toBeNull();
    // Without a manifest the kind of a block is unknown: no check.
    expect(await publishError(doc('page', { 'en-US': { path: '/a', content: puck([item('Frame')]) } }), null)).toBeNull();
  });

  it('publishing a base page requires exactly one layout block at root and no path', async () => {
    expect(await publishError(doc('base', { 'en-US': { content: puck([item('Frame', { region__header: [item('Heading')] })]) } }))).toBeNull();
    expect(await publishError(doc('base', { 'en-US': { content: puck([item('Heading')]) } }))).toMatchObject({ status: 422, code: 'invalid_base_root' });
    expect(await publishError(doc('base', { 'en-US': { content: puck([item('Frame'), item('Heading')]) } }))).toMatchObject({ code: 'invalid_base_root' });
    expect(await publishError(doc('base', { 'en-US': { content: puck([]) } }))).toMatchObject({ code: 'invalid_base_root' });
    expect(await publishError(doc('base', { 'en-US': { content: null } }))).toMatchObject({ code: 'invalid_base_root' });
    expect(await publishError(doc('base', { 'en-US': { content: puck([item('Frame', { region__main: [item('Frame')] })]) } }))).toMatchObject({ code: 'layout_block_misplaced' });
    expect(await publishError(doc('base', { 'en-US': { path: '/frame', content: puck([item('Frame')]) } }))).toMatchObject({ status: 422, code: 'base_has_path' });
    expect(await publishError(doc('base', { 'en-US': { content: puck([item('Frame')]) } }, { layout: { baseId: null } }))).toMatchObject({ code: 'invalid_layout' });
    // Without a manifest only the path is checked.
    expect(await publishError(doc('base', { 'en-US': { content: puck([item('Heading')]) } }), null)).toBeNull();
  });
});
