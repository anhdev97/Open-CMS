import { describe, expect, it } from 'vitest';
import { resolveStorefront } from '../../src/storefront/resolve-storefront';

describe('resolveStorefront', () => {
  it('defaults to enabled with http://127.0.0.1:3000', () => {
    expect(resolveStorefront(undefined, {})).toEqual({
      enabled: true,
      targetUrl: 'http://127.0.0.1:3000',
      port: 3000,
    });
  });

  it('uses opts.port when building the default URL', () => {
    expect(resolveStorefront({ port: 3100 }, {})).toMatchObject({
      enabled: true,
      targetUrl: 'http://127.0.0.1:3100',
      port: 3100,
    });
  });

  it('opts.targetUrl wins over port; strips trailing slash', () => {
    expect(resolveStorefront({ port: 3100, targetUrl: 'http://127.0.0.1:3999/' }, {})).toEqual({
      enabled: true,
      targetUrl: 'http://127.0.0.1:3999',
      port: 3999,
    });
  });

  it('OPENCMS_STOREFRONT_URL wins over opts.targetUrl and PORT', () => {
    expect(
      resolveStorefront(
        { targetUrl: 'http://127.0.0.1:1', port: 2 },
        { OPENCMS_STOREFRONT_URL: 'http://127.0.0.1:9/', OPENCMS_STOREFRONT_PORT: '8' },
      ),
    ).toEqual({ enabled: true, targetUrl: 'http://127.0.0.1:9', port: 9 });
  });

  it('OPENCMS_STOREFRONT_PORT applies only when URL unset', () => {
    expect(resolveStorefront({ port: 3000 }, { OPENCMS_STOREFRONT_PORT: '3200' })).toEqual({
      enabled: true,
      targetUrl: 'http://127.0.0.1:3200',
      port: 3200,
    });
  });

  it('OPENCMS_STOREFRONT_ENABLED overrides opts.enabled', () => {
    expect(resolveStorefront({ enabled: true }, { OPENCMS_STOREFRONT_ENABLED: 'false' }).enabled).toBe(false);
    expect(resolveStorefront({ enabled: false }, { OPENCMS_STOREFRONT_ENABLED: 'TRUE' }).enabled).toBe(true);
  });

  it('ignores garbage OPENCMS_STOREFRONT_ENABLED and keeps opts', () => {
    expect(resolveStorefront({ enabled: false }, { OPENCMS_STOREFRONT_ENABLED: 'maybe' }).enabled).toBe(false);
  });
});
