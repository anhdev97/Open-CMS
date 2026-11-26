import { beforeEach, describe, expect, it, vi } from 'vitest';
import { slugToPath } from '@opencloudcms/schema';

const api = vi.fn();
vi.mock('../../admin/src/lib/api', () => ({ api: (...a: unknown[]) => api(...a) }));

import {
  createPage,
  deletePage,
  duplicatePage,
  getPage,
  getShadowedPaths,
  isShadowedPath,
  listPages,
  listTruncation,
  pageErrorMessageKey,
  pagePreviewUrl,
  pageStatus,
  pagesTab,
  publishPage,
  savePage,
  unpublishPage,
  listBases,
  getBaseUsage,
  setDefaultBase,
  getBasePage,
  baseErrorMessage,
  splitPagesList,
} from '../../admin/src/lib/pages';
import { ApiError } from '../../admin/src/lib/api-error';

beforeEach(() => api.mockReset());

describe('pageStatus', () => {
  it('is draft when never published', () => {
    expect(pageStatus({ updatedAt: '2026-01-02T00:00:00Z' }, null)).toBe('draft');
  });
  it('is published when the draft is not newer than the published copy', () => {
    expect(pageStatus({ updatedAt: '2026-01-02T00:00:00Z' }, { publishedAt: '2026-01-02T00:00:00Z' })).toBe('published');
    expect(pageStatus({ updatedAt: '2026-01-01T00:00:00Z' }, { publishedAt: '2026-01-02T00:00:00Z' })).toBe('published');
  });
  it('is changed when the draft is newer than the published copy', () => {
    expect(pageStatus({ updatedAt: '2026-01-03T00:00:00Z' }, { publishedAt: '2026-01-02T00:00:00Z' })).toBe('changed');
  });
});

describe('pageStatus with the server flag', () => {
  const pub = { publishedAt: '2026-01-02T00:00:00Z' };
  it('trusts hasUnpublishedChanges over timestamps', () => {
    expect(pageStatus({ updatedAt: '2026-01-03T00:00:00Z', hasUnpublishedChanges: false }, pub)).toBe('published');
    expect(pageStatus({ updatedAt: '2026-01-01T00:00:00Z', hasUnpublishedChanges: true }, pub)).toBe('changed');
  });
  it('is still draft when never published', () => {
    expect(pageStatus({ updatedAt: '2026-01-03T00:00:00Z', hasUnpublishedChanges: true }, null)).toBe('draft');
  });
});

describe('slugToPath for the create dialog', () => {
  it('derives the path from the title', () => {
    expect(slugToPath('Giới thiệu')).toBe('/gioi-thieu');
  });
});

describe('page client', () => {
  it('listPages requests the locale', async () => {
    api.mockResolvedValue({ data: [{ documentId: 'a' }], meta: { total: 1 } });
    await expect(listPages('vi-VN')).resolves.toEqual({ data: [{ documentId: 'a' }], total: 1 });
    expect(api).toHaveBeenCalledWith('/api/admin/content/opencloudcmsPage?locale=vi-VN&limit=100');
  });
  it('listTruncation: { shown, total } only when the list holds fewer pages than exist', () => {
    expect(listTruncation(100, 250)).toEqual({ shown: 100, total: 250 });
    expect(listTruncation(3, 3)).toBeNull();
    expect(listTruncation(0, 0)).toBeNull();
  });
  it('createPage posts title and path in the locale', async () => {
    api.mockResolvedValue({ data: { documentId: 'n' } });
    await createPage({ title: 'About', path: '/about', locale: 'en-US' });
    expect(api).toHaveBeenCalledWith('/api/admin/content/opencloudcmsPage?locale=en-US', {
      method: 'POST',
      json: { title: 'About', path: '/about' },
    });
  });
  it('duplicatePage copies the draft with a -copy path and (copy) title', async () => {
    api
      .mockResolvedValueOnce({ data: { documentId: 'a', title: 'About', path: '/about', seo: { t: 1 }, content: { format: 'puck' } } })
      .mockResolvedValueOnce({ data: { documentId: 'b' } });
    await duplicatePage('a', 'en-US');
    expect(api).toHaveBeenNthCalledWith(1, '/api/admin/content/opencloudcmsPage/a?locale=en-US');
    expect(api).toHaveBeenNthCalledWith(2, '/api/admin/content/opencloudcmsPage?locale=en-US', {
      method: 'POST',
      json: { title: 'About (copy)', path: '/about-copy', seo: { t: 1 }, content: { format: 'puck' } },
    });
  });
  it('duplicatePage of the root page uses a valid path', async () => {
    api.mockResolvedValueOnce({ data: { title: 'Home', path: '/', content: null } }).mockResolvedValueOnce({ data: {} });
    await duplicatePage('h', 'en-US');
    expect(api.mock.calls[1]![1].json.path).toBe('/home-copy');
    expect(api.mock.calls[1]![1].json).not.toHaveProperty('seo');
  });
  it('deletePage deletes the document', async () => {
    api.mockResolvedValue(undefined);
    await deletePage('a');
    expect(api).toHaveBeenCalledWith('/api/admin/content/opencloudcmsPage/a', { method: 'DELETE' });
  });
});

describe('pageErrorMessageKey', () => {
  it('maps path errors to translated keys', () => {
    const e = (status: number, code: string, issues: unknown[] = []) => new ApiError(status, code, 'x', issues);
    expect(pageErrorMessageKey(e(409, 'unique_violation', [{ path: ['path'], message: 'already used' }]))).toBe('pages.errors.pathTaken');
    expect(pageErrorMessageKey(e(422, 'invalid_path'))).toBe('pages.errors.invalidPath');
    expect(pageErrorMessageKey(e(422, 'path_reserved'))).toBe('pages.errors.pathReserved');
    expect(pageErrorMessageKey(e(500, 'boom'))).toBeNull();
    expect(pageErrorMessageKey(new Error('x'))).toBeNull();
  });
});

describe('page editor client', () => {
  it('getPage reads the draft in the locale', async () => {
    api.mockResolvedValue({ data: { documentId: 'a', locale: 'vi-VN' } });
    await expect(getPage('a', 'vi-VN')).resolves.toEqual({ documentId: 'a', locale: 'vi-VN' });
    expect(api).toHaveBeenCalledWith('/api/admin/content/opencloudcmsPage/a?locale=vi-VN&status=draft');
  });
  it('savePage patches the locale with If-Match and returns the new updatedAt', async () => {
    api.mockResolvedValue({ data: { documentId: 'a', updatedAt: '2026-01-02T00:00:00.000Z' } });
    const body = { title: 'A', path: '/a', seo: {}, content: { format: 'puck' } };
    await expect(savePage('a', 'en-US', body, '2026-01-01T00:00:00.000Z')).resolves.toEqual({ updatedAt: '2026-01-02T00:00:00.000Z' });
    expect(api).toHaveBeenCalledWith('/api/admin/content/opencloudcmsPage/a?locale=en-US', {
      method: 'PATCH',
      json: body,
      headers: { 'If-Match': '"2026-01-01T00:00:00.000Z"' },
    });
  });
  it('savePage without If-Match sends no header', async () => {
    api.mockResolvedValue({ data: { updatedAt: 'x' } });
    await savePage('a', 'en-US', {}, undefined);
    expect(api.mock.calls[0]![1]).not.toHaveProperty('headers');
  });
  it('publishPage / unpublishPage post to the document', async () => {
    api.mockResolvedValue({ data: {} });
    await publishPage('a');
    await unpublishPage('a');
    expect(api).toHaveBeenNthCalledWith(1, '/api/admin/content/opencloudcmsPage/a/publish', { method: 'POST' });
    expect(api).toHaveBeenNthCalledWith(2, '/api/admin/content/opencloudcmsPage/a/unpublish', { method: 'POST' });
  });
  it('pagePreviewUrl points at the website preview route', () => {
    expect(pagePreviewUrl('a b', 'vi-VN')).toBe('/__opencloudcms/preview?page=a%20b&locale=vi-VN');
  });
});

describe('shadowed paths', () => {
  it('getShadowedPaths reads the endpoint once and caches it', async () => {
    api.mockResolvedValue({ data: ['/blog'] });
    const a = await getShadowedPaths();
    const b = await getShadowedPaths();
    expect(a).toEqual(['/blog']);
    expect(b).toBe(a);
    expect(api).toHaveBeenCalledTimes(1);
    expect(api).toHaveBeenCalledWith('/api/admin/pages/shadowed');
  });
  it('isShadowedPath matches exactly', () => {
    expect(isShadowedPath('/blog', ['/blog'])).toBe(true);
    expect(isShadowedPath('/blog/x', ['/blog'])).toBe(false);
    expect(isShadowedPath('/', [])).toBe(false);
    expect(isShadowedPath(undefined, ['/'])).toBe(false);
  });
});

describe('page builder style fields', () => {
  it('the library Columns block edits its tracks with the TrackField (max 6); null in and out', async () => {
    const { PAGE_CUSTOM_FIELDS, PageTracksPuckField, pageTracks } = await import('../../admin/src/page-editor/custom-fields');
    const { buildEditorConfig } = await import('../../admin/src/page-editor/editor-config');
    const { coreBlocks, defineBlocks } = await import('@opencloudcms/core/blocks');
    const stub = () => null as never;
    const config = buildEditorConfig(
      defineBlocks(coreBlocks),
      { locale: 'en-US', customFields: PAGE_CUSTOM_FIELDS, token: stub, contentType: stub, unknown: stub, wrapRender: (_n, r) => r },
      [],
    );
    expect(config.components.Columns!.fields!.tracks).toMatchObject({ type: 'custom', render: PageTracksPuckField, metadata: { blockField: { kind: 'tracks', max: 6 } } });
    expect(pageTracks.in(null)).toBeUndefined();
    expect(pageTracks.in({ base: ['1fr'] })).toEqual({ base: ['1fr'] });
    expect(pageTracks.out(undefined)).toBeNull();
    expect(pageTracks.out(['2fr', '1fr'])).toEqual(['2fr', '1fr']);
  });
});

describe('base pages client', () => {
  const e = (status: number, code: string, issues: unknown[] = []) => new ApiError(status, code, 'x', issues);

  it('createPage with kind base posts the title and kind, no path', async () => {
    api.mockResolvedValue({ data: { documentId: 'n' } });
    await createPage({ title: 'Site frame', kind: 'base', locale: 'en-US' });
    expect(api).toHaveBeenCalledWith('/api/admin/content/opencloudcmsPage?locale=en-US', { method: 'POST', json: { title: 'Site frame', kind: 'base' } });
  });
  it('listBases / getBaseUsage / setDefaultBase call the base endpoints', async () => {
    api.mockResolvedValueOnce({ data: [{ documentId: 'b', isDefault: true }] });
    await expect(listBases()).resolves.toEqual([{ documentId: 'b', isDefault: true }]);
    expect(api).toHaveBeenLastCalledWith('/api/admin/pages/bases');
    api.mockResolvedValueOnce({ count: 2, pages: [] });
    await expect(getBaseUsage('b')).resolves.toEqual({ count: 2, pages: [] });
    expect(api).toHaveBeenLastCalledWith('/api/admin/pages/bases/b/usage');
    api.mockResolvedValueOnce({ data: { documentId: null } });
    await setDefaultBase(null);
    expect(api).toHaveBeenLastCalledWith('/api/admin/pages/bases/default', { method: 'PUT', json: { documentId: null } });
  });
  it('getBasePage reads the admin draft base in the locale; 404 is null', async () => {
    api.mockResolvedValueOnce({ data: { documentId: 'b', content: {} } });
    await expect(getBasePage('default', 'vi-VN')).resolves.toEqual({ documentId: 'b', content: {} });
    expect(api).toHaveBeenLastCalledWith('/api/admin/content/opencloudcmsPage/base?id=default&locale=vi-VN');
    api.mockRejectedValueOnce(e(404, 'not_found'));
    await expect(getBasePage('b', 'en-US')).resolves.toBeNull();
    api.mockRejectedValueOnce(e(500, 'boom'));
    await expect(getBasePage('b', 'en-US')).rejects.toThrow();
  });
  it('unpublishPage can force', async () => {
    api.mockResolvedValue({ data: {} });
    await unpublishPage('a', { force: true });
    expect(api).toHaveBeenCalledWith('/api/admin/content/opencloudcmsPage/a/unpublish?force=true', { method: 'POST' });
  });
  it('base errors read as messages listing the pages', () => {
    const inUse = e(409, 'base_in_use', [
      { path: ['p1'], message: 'About' },
      { path: ['p2'], message: 'Contact' },
    ]);
    expect(baseErrorMessage(inUse)).toBe('Used by 2 pages: About, Contact.');
    expect(baseErrorMessage(e(409, 'base_is_default'))).toContain('default base page');
    expect(baseErrorMessage(e(422, 'layout_block_misplaced'))).toContain('Layout blocks');
    expect(baseErrorMessage(e(500, 'boom'))).toBeNull();
  });
  it('pagesTab reads ?tab=base; splitPagesList keeps base pages off the Pages tab', () => {
    expect(pagesTab('base')).toBe('base');
    expect(pagesTab(null)).toBe('pages');
    expect(pagesTab('x')).toBe('pages');
    const list = [{ documentId: 'a', kind: 'page' }, { documentId: 'b', kind: 'base' }, { documentId: 'c' }] as never[];
    expect(splitPagesList(list).map((p: { documentId: string }) => p.documentId)).toEqual(['a', 'c']);
  });
});
