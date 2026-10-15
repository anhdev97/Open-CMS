import { describe, expect, it, vi } from 'vitest';
import { JsonBodyParserMiddleware } from '../../src/http/body-parser.middleware';

const run = (req: Record<string, unknown>) => {
  const next = vi.fn();
  new JsonBodyParserMiddleware().use(req as never, {} as never, next);
  return next;
};

describe('JsonBodyParserMiddleware skips', () => {
  it('a request whose body a host parser already set', () => {
    const req = { path: '/api/x', body: { a: 1 } };
    const next = run(req);
    expect(next).toHaveBeenCalledWith();
    expect(req.body).toEqual({ a: 1 });
  });

  it.each(['/oauth2/token', '/OAuth2/token', '/OAUTH2'])('oidc-provider path %s, whatever its case', (path) => {
    const req = { path };
    expect(run(req)).toHaveBeenCalledWith();
    expect(req).not.toHaveProperty('body');
  });

  it('does not skip the Nest interaction routes, whatever their case', () => {
    // Not skipped means body-parser inspects the request; this stub has no headers, so it fails loudly if reached.
    const req = { path: '/OAuth2/Interaction/abc/login', headers: {}, method: 'POST', get: () => undefined };
    expect(() => run(req)).not.toThrow();
    expect(req).toHaveProperty('body');
  });
});
