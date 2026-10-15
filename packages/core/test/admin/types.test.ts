import { describe, expect, it } from 'vitest';
import { newId } from '../../admin/src/lib/types';

describe('newId', () => {
  it('builds a field id with a 6 char base36 suffix', () => {
    expect(newId('fld')).toMatch(/^fld_[a-z0-9]{6}$/);
  });

  it('builds a content type id with a 6 char base36 suffix', () => {
    expect(newId('ct')).toMatch(/^ct_[a-z0-9]{6}$/);
  });

  it('does not repeat', () => {
    expect(new Set(Array.from({ length: 50 }, () => newId('fld'))).size).toBe(50);
  });
});
