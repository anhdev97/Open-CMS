import { describe, expect, it } from 'vitest';
import { matchRoute } from '../../admin/src/router/match';

describe('matchRoute', () => {
  it('maps empty slug to guarded home', () => {
    expect(matchRoute([])).toEqual({ id: 'home', params: {}, guarded: true });
    expect(matchRoute(undefined)).toEqual({ id: 'home', params: {}, guarded: true });
  });
  it('leaves setup and login unguarded', () => {
    expect(matchRoute(['setup'])).toMatchObject({ id: 'setup', guarded: false });
    expect(matchRoute(['login'])).toMatchObject({ id: 'login', guarded: false });
  });
  it('captures content apiId', () => {
    expect(matchRoute(['content', 'posts'])).toEqual({ id: 'content', params: { apiId: 'posts' }, guarded: true });
    expect(matchRoute(['content']).id).toBe('notFound');
    expect(matchRoute(['content', 'a', 'b', 'c']).id).toBe('notFound');
  });
  it('matches the content sub-pages', () => {
    expect(matchRoute(['content', 'posts', 'new'])).toEqual({ id: 'contentNew', params: { apiId: 'posts' }, guarded: true });
    expect(matchRoute(['content', 'posts', 'd1'])).toEqual({ id: 'contentDetail', params: { apiId: 'posts', documentId: 'd1' }, guarded: true });
    expect(matchRoute(['content', 'posts', 'd1', 'edit'])).toEqual({ id: 'contentEdit', params: { apiId: 'posts', documentId: 'd1' }, guarded: true });
    expect(matchRoute(['content', 'posts', 'd1', 'edit', 'x']).id).toBe('notFound');
  });
  it('matches the simple guarded pages', () => {
    expect(matchRoute(['account'])).toEqual({ id: 'account', params: {}, guarded: true });
    expect(matchRoute(['assets'])).toEqual({ id: 'assets', params: {}, guarded: true });
  });
  it('matches the settings pages', () => {
    expect(matchRoute(['settings', 'users'])).toEqual({ id: 'settingsUsers', params: {}, guarded: true });
    expect(matchRoute(['settings', 'content-types'])).toMatchObject({ id: 'settingsContentTypes' });
    expect(matchRoute(['settings', 'languages'])).toMatchObject({ id: 'settingsLanguages' });
    expect(matchRoute(['settings']).id).toBe('notFound');
    expect(matchRoute(['settings', 'nope']).id).toBe('notFound');
  });
  it('matches the block routes', () => {
    expect(matchRoute(['settings', 'blocks'])).toEqual({ id: 'settingsBlocks', params: {}, guarded: true });
    expect(matchRoute(['settings', 'blocks', 'ProductCard'])).toEqual({ id: 'blockEditor', params: { name: 'ProductCard' }, guarded: true, fullScreen: true });
    expect(matchRoute(['settings', 'blocks', 'new'])).toEqual({ id: 'blockEditor', params: { name: 'new' }, guarded: true, fullScreen: true });
    expect(matchRoute(['settings', 'blocks', 'a', 'b']).id).toBe('notFound');
    expect(matchRoute(['settings', 'users', 'x']).id).toBe('notFound');
  });
  it('redirects the old users and builder routes', () => {
    expect(matchRoute(['users'])).toEqual({ id: 'redirectUsers', params: {}, guarded: true });
    expect(matchRoute(['builder'])).toEqual({ id: 'redirectBuilder', params: {}, guarded: true });
  });
  it('matches the pages list and the full-screen editor', () => {
    expect(matchRoute(['pages'])).toEqual({ id: 'pages', params: {}, guarded: true });
    expect(matchRoute(['pages', 'abc-123'])).toEqual({ id: 'pageEditor', params: { documentId: 'abc-123' }, guarded: true, fullScreen: true });
    expect(matchRoute(['pages']).fullScreen).toBeUndefined();
    expect(matchRoute(['pages', 'a', 'b']).id).toBe('notFound');
  });
  it('falls back to guarded notFound', () => {
    expect(matchRoute(['nope'])).toEqual({ id: 'notFound', params: {}, guarded: true });
  });
  it('exposes _ui only in dev', () => {
    expect(matchRoute(['_ui'], { dev: true })).toMatchObject({ id: 'uikit', guarded: false });
    expect(matchRoute(['_ui'], { dev: false }).id).toBe('notFound');
  });
});
