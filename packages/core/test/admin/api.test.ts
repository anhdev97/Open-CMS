import { describe, expect, it, vi } from 'vitest';
import { api } from '../../admin/src/lib/api';
import { ApiError } from '../../admin/src/lib/api-error';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

function setup(res: Response) {
  const fetch = vi.fn(async () => res);
  const assign = vi.fn();
  const location = { assign, pathname: '/admin/builder', search: '?type=product' };
  return { fetch: fetch as unknown as typeof globalThis.fetch, mock: fetch, assign, location };
}

describe('api', () => {
  it('returns parsed JSON and sends same-origin credentials', async () => {
    const s = setup(json(200, { id: 'u1' }));
    await expect(api('/api/auth/me', {}, s)).resolves.toEqual({ id: 'u1' });
    expect(s.mock).toHaveBeenCalledWith('/api/auth/me', expect.objectContaining({ credentials: 'same-origin' }));
  });

  it('serialises json bodies with a JSON content type', async () => {
    const s = setup(json(200, {}));
    await api('/api/x', { method: 'POST', json: { a: 1 } }, s);
    const init = s.mock.mock.calls[0][1] as unknown as RequestInit;
    expect(init.body).toBe('{"a":1}');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });

  it('returns undefined for 204', async () => {
    const s = setup(new Response(null, { status: 204 }));
    await expect(api('/api/auth/password', { method: 'POST' }, s)).resolves.toBeUndefined();
  });

  it('throws ApiError with status, code, message and issues', async () => {
    const s = setup(json(422, { error: { code: 'validation_failed', message: 'bad', issues: [{ path: 'a', message: 'x' }] } }));
    const err = await api('/api/x', {}, s).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 422, code: 'validation_failed', message: 'bad', issues: [{ path: 'a', message: 'x' }] });
    expect(err.retryAfterSec).toBeUndefined();
  });

  it('falls back to code "error" and the status text for a non-JSON failure', async () => {
    const s = setup(new Response('nope', { status: 502, statusText: 'Bad Gateway' }));
    await expect(api('/api/x', {}, s)).rejects.toMatchObject({ status: 502, code: 'error', message: 'Bad Gateway', issues: [] });
  });

  it('exposes Retry-After as retryAfterSec', async () => {
    const s = setup(json(429, { error: { code: 'rate_limited', message: 'slow' } }, { 'Retry-After': '30' }));
    await expect(api('/oauth2/interaction/u/login', { method: 'POST' }, s)).rejects.toMatchObject({ status: 429, retryAfterSec: 30 });
  });

  it('redirects to login on 401 unauthenticated and still throws', async () => {
    const s = setup(json(401, { error: { code: 'unauthenticated', message: 'no' } }));
    await expect(api('/api/x', {}, s)).rejects.toMatchObject({ status: 401, code: 'unauthenticated' });
    expect(s.assign).toHaveBeenCalledWith('/api/auth/login?returnTo=%2Fadmin%2Fbuilder%3Ftype%3Dproduct');
  });

  it('does not redirect with redirectOn401: false', async () => {
    const s = setup(json(401, { error: { code: 'unauthenticated', message: 'no' } }));
    await expect(api('/api/x', { redirectOn401: false }, s)).rejects.toBeInstanceOf(ApiError);
    expect(s.assign).not.toHaveBeenCalled();
  });

  it('does not redirect on a 401 with another code', async () => {
    const s = setup(json(401, { error: { code: 'invalid_credentials', message: 'no' } }));
    await expect(api('/api/x', {}, s)).rejects.toMatchObject({ code: 'invalid_credentials' });
    expect(s.assign).not.toHaveBeenCalled();
  });
});
