import { describe, expect, it } from 'vitest';
import { initialLocaleState, resolveAdminLocale } from '../../admin/src/i18n/resolve';
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

describe('initialLocaleState', () => {
  it('en-US needs no bundle load', () => {
    expect(initialLocaleState({ stored: null, browser: ['en-GB'] })).toEqual({ locale: 'en-US', needsLoad: false });
  });
  it('stored non-default locale must load before render', () => {
    expect(initialLocaleState({ stored: 'fr-FR', browser: ['en'] })).toEqual({ locale: 'fr-FR', needsLoad: true });
  });
  it('browser language is used when nothing is stored', () => {
    expect(initialLocaleState({ browser: ['vi'] })).toEqual({ locale: 'vi-VN', needsLoad: true });
  });
  it('explicit initialLocale wins', () => {
    expect(initialLocaleState({ initialLocale: 'id-ID', stored: 'fr-FR' }).locale).toBe('id-ID');
  });
});
