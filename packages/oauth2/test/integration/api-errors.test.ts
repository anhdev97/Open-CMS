import 'reflect-metadata';
import { BadRequestException, ConflictException, Controller, ForbiddenException, Get, Post } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Public } from '../../src/guard/public.decorator';
import { createTestApp, type TestApp } from '../support/app';

@Public()
@Controller('api/test-errors')
class ThrowingController {
  @Get('conflict')
  conflict(): never {
    throw new ConflictException('Already there');
  }

  @Get('forbidden')
  forbidden(): never {
    throw new ForbiddenException();
  }

  @Get('bad-request')
  badRequest(): never {
    throw new BadRequestException('Nope');
  }

  @Get('boom')
  boom(): never {
    throw new TypeError('secret detail /etc/passwd');
  }

  @Post('echo')
  echo(): { ok: true } {
    return { ok: true };
  }
}

/** A host-app route outside /api keeps Nest's default error JSON. */
@Public()
@Controller('host-errors')
class HostThrowingController {
  @Get('conflict')
  conflict(): never {
    throw new ConflictException('Already there');
  }

  @Get('boom')
  boom(): never {
    throw new Error('boom');
  }
}

/** M2: every error under /api/** has the §8 shape `{ error: { code, message } }`. */
describe('§8 error JSON for non-AuthError failures under /api', () => {
  let t: TestApp;
  const get = async (path: string) => {
    const res = await fetch(`${t.url}${path}`);
    return { status: res.status, body: await res.json() };
  };

  beforeAll(async () => {
    t = await createTestApp({}, { controllers: [ThrowingController, HostThrowingController] });
  });
  afterAll(async () => {
    await t?.close();
  });

  it('malformed JSON body → 422 validation_failed', async () => {
    const res = await fetch(`${t.url}/api/test-errors/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: t.url },
      body: '{"a":',
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: { code: 'validation_failed', message: expect.any(String) } });
  });

  it('oversized JSON body → 413 payload_too_large (body-parser client errors keep their status)', async () => {
    const res = await fetch(`${t.url}/api/test-errors/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: t.url },
      body: JSON.stringify({ a: 'x'.repeat(200_000) }),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: { code: 'payload_too_large', message: expect.any(String) } });
  });

  it('unknown /api route (any case) → 404 not_found', async () => {
    for (const path of ['/api/does-not-exist', '/API/Nope/x']) {
      const r = await get(path);
      expect(r.status, path).toBe(404);
      expect(r.body, path).toEqual({ error: { code: 'not_found', message: expect.any(String) } });
    }
  });

  it('other HttpExceptions keep their status with a code derived from it', async () => {
    expect(await get('/api/test-errors/conflict')).toEqual({ status: 409, body: { error: { code: 'conflict', message: 'Already there' } } });
    expect((await get('/api/test-errors/forbidden')).body.error.code).toBe('forbidden');
    expect(await get('/api/test-errors/bad-request')).toEqual({ status: 400, body: { error: { code: 'bad_request', message: 'Nope' } } });
  });

  it('unknown errors → 500 internal_error with a generic message (nothing of the original leaks)', async () => {
    const r = await get('/api/test-errors/boom');
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: { code: 'internal_error', message: 'Internal server error' } });
    expect(JSON.stringify(r.body)).not.toContain('passwd');
  });

  it('AuthError keeps its own code', async () => {
    const r = await get('/api/auth/me');
    expect(r.body.error.code).toBe('setup_required');
  });

  it('paths outside /api keep Nest defaults', async () => {
    expect(await get('/host-errors/conflict')).toEqual({
      status: 409,
      body: { statusCode: 409, message: 'Already there', error: 'Conflict' },
    });
    expect(await get('/host-errors/boom')).toEqual({ status: 500, body: { statusCode: 500, message: 'Internal server error' } });
    expect((await get('/nothing-here')).body).toMatchObject({ statusCode: 404 });
  });
});
