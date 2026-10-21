import { describe, expect, it } from 'vitest';
import { defineContentGroups, validateContentGroups } from '../src/groups';
import { collectSchemaIssues } from '../src/validate';
import { defineContentType, f } from '../src/define';

describe('validateContentGroups', () => {
  it('accepts valid groups', () => {
    expect(validateContentGroups([{ key: 'shop', title: { 'en-US': 'Shop' }, order: 2 }])).toEqual([]);
  });
  it('reports issues', () => {
    expect(validateContentGroups([{ key: 'Bad Key', title: { 'en-US': 'x' } }])).not.toEqual([]);
    expect(validateContentGroups([
      { key: 'a', title: { 'en-US': 'x' } },
      { key: 'a', title: { 'en-US': 'y' } },
    ])).not.toEqual([]);
    expect(validateContentGroups([{ key: 'a', title: {} }])).not.toEqual([]);
    expect(validateContentGroups([{ key: 'a', title: { 'en-US': '' } }])).not.toEqual([]);
    expect(validateContentGroups([{ key: 'a', title: { 'en-US': 'x', 'de-DE': 'y' } }])).not.toEqual([]);
    expect(validateContentGroups([{ key: 'a', title: { 'en-US': 'x' }, order: 1.5 }])).not.toEqual([]);
    expect(validateContentGroups('nope')).not.toEqual([]);
  });
  it('defineContentGroups throws', () => {
    expect(() => defineContentGroups([{ key: 'X', title: { 'en-US': 'x' } }])).toThrow();
  });
});

describe('definition validation of group and displayName', () => {
  const base = () => defineContentType({ id: 'ct_1', apiId: 'product', displayName: 'Product', fields: { title: f.text({ id: 'fld_1' }) } });
  it('keeps group and localized displayName', () => {
    const d = defineContentType({ id: 'ct_1', apiId: 'product', displayName: { 'en-US': 'P', 'vi-VN': 'SP' }, group: 'shop', fields: {} });
    expect(d.group).toBe('shop');
    expect(collectSchemaIssues([d])).toEqual([]);
  });
  it('rejects bad group', () => {
    expect(collectSchemaIssues([{ ...base(), group: 'Bad Key' }])).not.toEqual([]);
  });
  it('rejects displayName without en-US, accepts string', () => {
    expect(collectSchemaIssues([{ ...base(), displayName: { 'vi-VN': 'x' } as any }])).not.toEqual([]);
    expect(collectSchemaIssues([base()])).toEqual([]);
  });
});
