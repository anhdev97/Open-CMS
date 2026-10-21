import { describe, expect, it } from 'vitest';
import { defineLocales, validateLocaleSettings } from '../src/locales';
import { resolveConfig } from '../src/config';

describe('validateLocaleSettings', () => {
  it('accepts valid settings', () => {
    expect(validateLocaleSettings({ defaultLocale: 'en-US', locales: ['en-US', 'vi-VN'] })).toEqual([]);
  });
  it('rejects bad input with one issue each', () => {
    expect(validateLocaleSettings({ defaultLocale: 'en-US', locales: [] })).toHaveLength(1);
    expect(validateLocaleSettings({ defaultLocale: 'en-US', locales: ['en-US', 'en-US'] })).toHaveLength(1);
    const en = validateLocaleSettings({ defaultLocale: 'en-US', locales: ['en-US', 'en'] });
    expect(en).toHaveLength(1);
    expect(en[0]).toContain('en-US');
    expect(validateLocaleSettings({ defaultLocale: 'en-US', locales: ['en-US', 'de-DE'] })).toHaveLength(1);
    expect(validateLocaleSettings({ defaultLocale: 'vi-VN', locales: ['en-US'] })).toHaveLength(1);
  });
  it('defineLocales throws', () => {
    expect(() => defineLocales({ defaultLocale: 'vi-VN', locales: ['en-US'] })).toThrow();
    const ok = { defaultLocale: 'en-US', locales: ['en-US'] } as const;
    expect(defineLocales({ defaultLocale: 'en-US', locales: ['en-US'] })).toEqual(ok);
  });
});

describe('resolveConfig locales', () => {
  const database = { url: 'postgres://x' };
  it('defaults to en-US', () => {
    const c = resolveConfig({ database }, '/r');
    expect(c.defaultLocale).toBe('en-US');
    expect(c.locales).toEqual(['en-US']);
  });
  it('rejects short codes', () => {
    expect(() => resolveConfig({ database, locales: ['en'] as any }, '/r')).toThrow(/en-US/);
  });
});
