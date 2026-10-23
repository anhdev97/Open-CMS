import { describe, expect, it } from 'vitest';
import { createTranslator, defineMessages, formatNumber, isLocale, localizedText, matchLocale } from '../src/i18n';

describe('matchLocale', () => {
  it.each([
    ['vi', 'vi-VN'],
    ['VI-vn', 'vi-VN'],
    ['fr-CA', 'fr-FR'],
    [['de', 'id'], 'id-ID'],
    ['fr;q=0.5, vi;q=0.9', 'vi-VN'],
    ['', 'en-US'],
    [null, 'en-US'],
    [['de'], 'en-US'],
  ])('%j -> %s', (input, expected) => {
    expect(matchLocale(input as any)).toBe(expected);
  });
});

describe('isLocale', () => {
  it('accepts only supported codes', () => {
    expect(isLocale('en-US')).toBe(true);
    expect(isLocale('en')).toBe(false);
    expect(isLocale(3)).toBe(false);
  });
});

describe('createTranslator', () => {
  const messages = defineMessages({
    'en-US': { hello: 'Hello {name}', only: 'Only English', nested: { a: 'A' } },
    'vi-VN': { hello: 'Xin chào {name}' },
  });
  it('uses the locale value', () => {
    expect(createTranslator(messages, 'vi-VN')('hello', { name: 'An' })).toBe('Xin chào An');
  });
  it('falls back to en-US, then key', () => {
    const t = createTranslator(messages, 'vi-VN');
    expect(t('only')).toBe('Only English');
    expect(t('nested.a')).toBe('A');
    expect(t('nope')).toBe('nope');
  });
  it('keeps unknown placeholders', () => {
    expect(createTranslator(messages, 'en-US')('hello', {})).toBe('Hello {name}');
  });
});

describe('localizedText', () => {
  it('handles strings, maps and fallback', () => {
    expect(localizedText('Product', 'vi-VN')).toBe('Product');
    expect(localizedText({ 'en-US': 'Shop', 'vi-VN': 'Cửa hàng' }, 'fr-FR')).toBe('Shop');
    expect(localizedText({ 'en-US': 'Shop', 'vi-VN': 'Cửa hàng' }, 'vi-VN')).toBe('Cửa hàng');
    expect(localizedText(undefined, 'en-US', 'shop')).toBe('shop');
    expect(localizedText(undefined, 'en-US')).toBe('');
  });
});

describe('formatNumber', () => {
  it('uses Intl', () => {
    expect(formatNumber(1234.5, 'vi-VN')).toBe(new Intl.NumberFormat('vi-VN').format(1234.5));
  });
});
