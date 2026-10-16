import { describe, expect, it, vi } from 'vitest';
import { AuthError, AuthExceptionFilter } from '../../src/errors';

function fakeHost(res: { statusCode?: number; body?: unknown }) {
  const response = {
    status(code: number) {
      res.statusCode = code;
      return this;
    },
    json(body: unknown) {
      res.body = body;
      return this;
    },
    setHeader() {
      return this;
    },
  };
  return {
    switchToHttp: () => ({ getResponse: () => response }),
  } as any;
}

describe('AuthError role_in_use rendering', () => {
  it('includes userCount beside code and message', () => {
    const out: { statusCode?: number; body?: unknown } = {};
    const err = new AuthError('role_in_use', 409, 'Role is assigned to 2 users', { userCount: 2 });
    new AuthExceptionFilter().catch(err, fakeHost(out));
    expect(out.statusCode).toBe(409);
    expect(out.body).toEqual({
      error: { code: 'role_in_use', message: 'Role is assigned to 2 users', userCount: 2 },
    });
  });

  it('omits userCount when unset', () => {
    const out: { statusCode?: number; body?: unknown } = {};
    new AuthExceptionFilter().catch(new AuthError('forbidden', 403, 'Forbidden'), fakeHost(out));
    expect(out.body).toEqual({ error: { code: 'forbidden', message: 'Forbidden' } });
  });
});
