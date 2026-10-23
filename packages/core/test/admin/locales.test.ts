import { describe, expect, it } from 'vitest';
import { pickEditorLocale, planLocaleChange } from '../../admin/src/lib/locales';

const counts = { 'en-US': 5, 'vi-VN': 3, 'fr-FR': 0, 'id-ID': 0 };

describe('planLocaleChange', () => {
  const current = { locales: ['en-US', 'vi-VN', 'fr-FR'] as const, defaultLocale: 'en-US' as const };
  it('lists disabled locales that still have entries', () => {
    const r = planLocaleChange({ ...current, locales: [...current.locales] }, { locales: ['en-US', 'fr-FR'], defaultLocale: 'en-US' }, counts);
    expect(r.needsConfirm).toEqual(['vi-VN']);
  });
  it('does not list disabled locales without entries', () => {
    const r = planLocaleChange({ ...current, locales: [...current.locales] }, { locales: ['en-US', 'vi-VN'], defaultLocale: 'en-US' }, counts);
    expect(r.needsConfirm).toEqual([]);
  });
  it('ignores locales that were not enabled before', () => {
    const r = planLocaleChange({ locales: ['en-US'], defaultLocale: 'en-US' }, { locales: ['en-US'], defaultLocale: 'en-US' }, counts);
    expect(r.needsConfirm).toEqual([]);
  });
});

describe('pickEditorLocale', () => {
  it('keeps an enabled locale', () => {
    expect(pickEditorLocale('vi-VN', ['en-US', 'vi-VN'], 'en-US')).toBe('vi-VN');
  });
  it('falls back to the default when disabled, unknown or missing', () => {
    expect(pickEditorLocale('fr-FR', ['en-US'], 'en-US')).toBe('en-US');
    expect(pickEditorLocale('xx', ['en-US'], 'en-US')).toBe('en-US');
    expect(pickEditorLocale(null, ['en-US', 'vi-VN'], 'vi-VN')).toBe('vi-VN');
    expect(pickEditorLocale('', ['en-US'], 'en-US')).toBe('en-US');
  });
});
