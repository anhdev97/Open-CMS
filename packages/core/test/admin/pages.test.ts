import { beforeEach, describe, expect, it, vi } from 'vitest';
import { slugToPath } from '@opencloudcms/schema';

const api = vi.fn();
vi.mock('../../admin/src/lib/api', () => ({ api: (...a: unknown[]) => api(...a) }));

import {
  createPage,
  deletePage,
  duplicatePage,
  getPage,
  listPages,
  pageErrorMessageKey,
  pagePreviewUrl,
  pageStatus,
  publishPage,
  savePage,
  unpublishPage,
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
