import { describe, expect, it } from 'vitest';
import { buildSidebarTree } from '../../admin/src/lib/sidebar-tree';

const g = (key: string, en: string, order?: number, vi?: string) => ({
  key,
  title: { 'en-US': en, ...(vi ? { 'vi-VN': vi } : {}) },
  ...(order === undefined ? {} : { order }),
});

describe('buildSidebarTree', () => {
  it('sorts groups by order, then title; missing order last', () => {
    const groups = [g('c', 'Zeta'), g('b', 'Beta', 20), g('a', 'Alpha', 10), g('d', 'Alpha2')];
    const types = groups.map((x) => ({ apiId: `t-${x.key}`, displayName: 'X', group: x.key }));
    expect(buildSidebarTree(types, groups, 'en-US').map((x) => x.key)).toEqual(['a', 'b', 'd', 'c']);
  });
  it('breaks equal order ties by localized title', () => {
    const groups = [g('x', 'Banana', 5), g('y', 'Apple', 5)];
    const types = groups.map((x) => ({ apiId: x.key, displayName: 'X', group: x.key }));
    expect(buildSidebarTree(types, groups, 'en-US').map((x) => x.key)).toEqual(['y', 'x']);
  });
  it('sorts items by title and puts ungrouped types last', () => {
    const tree = buildSidebarTree(
      [
        { apiId: 'z', displayName: 'Zebra', group: 'a' },
        { apiId: 'm', displayName: 'Moose', group: 'a' },
        { apiId: 'u', displayName: 'Loose' },
        { apiId: 'q', displayName: 'Orphan', group: 'missing-group' },
      ],
      [g('a', 'A')],
      'en-US',
    );
    expect(tree.map((x) => x.key)).toEqual(['a', '__ungrouped']);
    expect(tree[0].items.map((i) => i.apiId)).toEqual(['m', 'z']);
    expect(tree[1].items.map((i) => i.apiId)).toEqual(['u', 'q']);
  });
  it('omits groups without types', () => {
    const tree = buildSidebarTree([{ apiId: 'a', displayName: 'A', group: 'one' }], [g('one', 'One'), g('two', 'Two')], 'en-US');
    expect(tree.map((x) => x.key)).toEqual(['one']);
  });
  it('omits the ungrouped entry when empty', () => {
    expect(buildSidebarTree([], [g('one', 'One')], 'en-US')).toEqual([]);
  });
  it('uses localized titles when present, en-US otherwise', () => {
    const tree = buildSidebarTree(
      [
        { apiId: 'a', displayName: { 'en-US': 'Article', 'vi-VN': 'Bài viết' }, group: 'one' },
        { apiId: 'b', displayName: 'Plain', group: 'one' },
      ],
      [g('one', 'One', 1, 'Một')],
      'vi-VN',
    );
    expect(tree[0].title).toBe('Một');
    expect(tree[0].items).toEqual([
      { apiId: 'a', title: 'Bài viết' },
      { apiId: 'b', title: 'Plain' },
    ]);
  });
});
