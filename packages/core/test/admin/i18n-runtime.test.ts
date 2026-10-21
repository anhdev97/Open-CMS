import { describe, expect, it } from 'vitest';
import { resolveAdminLocale } from '../../admin/src/i18n/resolve';
import { t } from '../../admin/src/i18n';
import * as server from '../../src/index';

describe('resolveAdminLocale', () => {
  it('prefers a valid user locale', () => {
    expect(resolveAdminLocale({ userLocale: 'vi-VN', stored: 'fr-FR', browser: ['id'] })).toBe('vi-VN');
  });
  it('falls back to stored when user locale is invalid', () => {
    expect(resolveAdminLocale({ userLocale: 'xx', stored: 'fr-FR' })).toBe('fr-FR');
  });
  it('uses the browser list', () => {
    expect(resolveAdminLocale({ browser: ['id'] })).toBe('id-ID');
  });
  it('defaults to en-US', () => {
    expect(resolveAdminLocale({})).toBe('en-US');
  });
});

describe('t', () => {
  it('fills variables from the active bundle', () => {
    expect(t('setup.passwordHint', { min: 8, max: 128 })).toBe('8 to 128 characters.');
  });
});

describe('core server entry', () => {
  it('exports the i18n helpers', () => {
    for (const k of ['SUPPORTED_LOCALES', 'isLocale', 'matchLocale', 'localizedText', 'defineMessages', 'createTranslator', 'formatDateTime', 'formatNumber']) {
      expect(k in server, k).toBe(true);
    }
  });
});
