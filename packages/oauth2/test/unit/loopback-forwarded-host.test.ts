import type { IncomingMessage } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { loopbackForwardedHost, providerMountHandlers } from '../../src/provider/provider.factory';

const run = (remoteAddress: string | undefined, headers: Record<string, string | string[]>) => {
  const req = { socket: { remoteAddress }, headers: { host: '127.0.0.1:4000', ...headers } } as unknown as IncomingMessage;
  const next = vi.fn();
  loopbackForwardedHost(req, undefined, next);
  expect(next).toHaveBeenCalledOnce();
  return req.headers.host;
};

describe('loopbackForwardedHost', () => {
  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])('loopback peer %s: Host comes from X-Forwarded-Host', (addr) => {
    expect(run(addr, { 'x-forwarded-host': 'localhost:4000' })).toBe('localhost:4000');
  });
  it.each(['10.0.0.5', '203.0.113.9', '::ffff:10.0.0.5', undefined])('non-loopback peer %s keeps its Host', (addr) => {
    expect(run(addr, { 'x-forwarded-host': 'evil.example' })).toBe('127.0.0.1:4000');
  });
  it('no header, or an array value, leaves Host unchanged', () => {
    expect(run('127.0.0.1', {})).toBe('127.0.0.1:4000');
    expect(run('127.0.0.1', { 'x-forwarded-host': ['a.example', 'b.example'] })).toBe('127.0.0.1:4000');
  });
});

describe('providerMountHandlers', () => {
  const cb = () => {};
  it('http public URL: host rewrite runs before the provider', () => {
    expect(providerMountHandlers('http://localhost:4000', cb)).toEqual([loopbackForwardedHost, cb]);
  });
  it('https public URL: only the provider (proxy mode handles forwarding)', () => {
    expect(providerMountHandlers('https://cms.example.com', cb)).toEqual([cb]);
  });
});
