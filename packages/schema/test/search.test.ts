import { describe, expect, it } from 'vitest';
import { foldSearch } from '../src';

describe('foldSearch', () => {
  it('lowercases, strips combining marks and folds đ/Đ to d', () => {
    expect(foldSearch('Dịch vụ')).toBe('dich vu');
    expect(foldSearch('ĐẶT HÀNG')).toBe('dat hang');
    expect(foldSearch('đường')).toBe('duong');
    expect(foldSearch('Crème Brûlée')).toBe('creme brulee');
    expect(foldSearch('')).toBe('');
  });
  it('matches accent-insensitive contains', () => {
    expect(foldSearch('Dịch vụ khách hàng').includes(foldSearch('DICH'))).toBe(true);
  });
});
