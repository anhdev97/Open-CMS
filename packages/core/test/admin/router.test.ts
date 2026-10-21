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
    expect(matchRoute(['content', 'a', 'b']).id).toBe('notFound');
  });
  it('matches the simple guarded pages', () => {
    for (const id of ['builder', 'users', 'account'] as const) {
      expect(matchRoute([id])).toEqual({ id, params: {}, guarded: true });
    }
  });
  it('falls back to guarded notFound', () => {
    expect(matchRoute(['nope'])).toEqual({ id: 'notFound', params: {}, guarded: true });
  });
  it('exposes _ui only in dev', () => {
    expect(matchRoute(['_ui'], { dev: true })).toMatchObject({ id: 'uikit', guarded: false });
    expect(matchRoute(['_ui'], { dev: false }).id).toBe('notFound');
  });
});
