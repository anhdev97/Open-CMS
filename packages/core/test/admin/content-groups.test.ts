import { describe, expect, it } from 'vitest';
import { fromLocalizedText, groupUsage, toLocalizedText } from '../../admin/src/lib/content-groups';

describe('toLocalizedText', () => {
  it('returns a plain string when only en-US is filled', () => {
    expect(toLocalizedText({ 'en-US': 'Shop' })).toBe('Shop');
  });
  it('returns a map when another locale is filled', () => {
    expect(toLocalizedText({ 'en-US': 'Shop', 'vi-VN': 'Cửa hàng' })).toEqual({ 'en-US': 'Shop', 'vi-VN': 'Cửa hàng' });
  });
  it('drops empty and whitespace-only non-en values', () => {
    expect(toLocalizedText({ 'en-US': 'Shop', 'vi-VN': '   ', 'fr-FR': '' })).toBe('Shop');
    expect(toLocalizedText({ 'en-US': ' Shop ', 'id-ID': ' Toko ' })).toEqual({ 'en-US': 'Shop', 'id-ID': 'Toko' });
  });
  it('keeps an empty en-US so validation can reject it', () => {
    expect(toLocalizedText({ 'vi-VN': 'x' })).toEqual({ 'en-US': '', 'vi-VN': 'x' });
  });
});

describe('fromLocalizedText', () => {
  it('expands strings and maps to per-locale inputs', () => {
    expect(fromLocalizedText('Shop')).toEqual({ 'en-US': 'Shop' });
    expect(fromLocalizedText({ 'en-US': 'Shop', 'fr-FR': 'Boutique' })).toEqual({ 'en-US': 'Shop', 'fr-FR': 'Boutique' });
    expect(fromLocalizedText(undefined)).toEqual({ 'en-US': '' });
  });
});

describe('groupUsage', () => {
  it('counts types per group, including groups without types', () => {
    const groups = [
      { key: 'shop', title: { 'en-US': 'Shop' } },
      { key: 'blog', title: { 'en-US': 'Blog' } },
    ];
    const types = [{ group: 'shop' }, { group: 'shop' }, {}, { group: 'gone' }];
    expect(groupUsage(groups, types)).toEqual({ shop: 2, blog: 0 });
  });
});
