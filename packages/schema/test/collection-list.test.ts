import { describe, expect, it } from 'vitest';
import {
  collectionListsOf, composedFieldNameIssue, ELEMENT_BINDABLE, INTERACTIVE_ELEMENTS, isBreakingChange, validateComposedSpec,
  type ComposedBlockSpec, type ComposedNode,
} from '../src/composed-block';

const card = (): ComposedNode => ({
  el: 'Card', bind: { href: { from: 'entryUrl' } },
  children: [{ el: 'Heading', bind: { text: { from: 'entry', path: 'question' } } }],
});
const list = (key = 'list', extra: Record<string, unknown> = {}): ComposedNode => ({
  el: 'CollectionList', props: { key, apiId: 'question', ...extra }, children: [card()],
});
const questions = (): ComposedBlockSpec => ({
  id: 'blk_questions1', name: 'Questions', label: { 'en-US': 'Questions' }, category: 'Content', version: 1,
  fields: { title: { kind: 'text', default: 'Questions' } },
  tree: { el: 'Stack', children: [
    { el: 'Heading', bind: { text: { from: 'field', name: 'title' } } },
    list(),
    { el: 'Button', bind: { label: { from: 'const', value: 'See all' } } },
  ] },
});
const paths = (s: unknown, o?: Parameters<typeof validateComposedSpec>[1]) => validateComposedSpec(s, o).map((i) => i.path.join('.'));
const mut = (base: ComposedBlockSpec, f: (s: any) => void) => { const s = structuredClone(base) as any; f(s); return s; };

describe('CollectionList element', () => {
  it('is bindable on nothing and not interactive', () => {
    expect(ELEMENT_BINDABLE.CollectionList).toEqual([]);
    expect(INTERACTIVE_ELEMENTS).not.toContain('CollectionList');
  });

  it('accepts a block with a heading and a list of question cards', () => {
    expect(validateComposedSpec(questions())).toEqual([]);
  });

  it('accepts every documented prop', () => {
    const s = mut(questions(), (x) => (x.tree.children[1].props = {
      key: 'faqs', apiId: 'question', filter: [{ field: 'featured', value: true }], sort: { field: 'order', direction: 'asc' },
      limit: 50, layout: { kind: 'carousel', columns: 1 }, emptyText: { 'en-US': 'None yet' }, urlPattern: '/q/{slug}',
      editor: { filter: true, sort: false, limit: true, layout: true },
    }));
    expect(validateComposedSpec(s)).toEqual([]);
  });

  it('rejects entry sources outside the list without a single binding', () => {
    const s = mut(questions(), (x) => (x.tree.children[0].bind = { text: { from: 'entry', path: 'title' } }));
    expect(paths(s)).toEqual(['tree.children.0.bind.text']);
    const show = mut(questions(), (x) => (x.tree.children[0].showIf = { from: 'entry', path: 'title', is: 'present' }));
    expect(paths(show)).toEqual(['tree.children.0.showIf']);
    const url = mut(questions(), (x) => (x.tree.children[2].bind.href = { from: 'entryUrl' }));
    expect(paths(url)).toEqual(['tree.children.2.bind.href']);
  });

  it('allows entry sources outside the list with a single binding', () => {
    const s = mut(questions(), (x) => {
      x.binding = { apiId: 'product', mode: 'single', urlPattern: '/p/{slug}' };
      x.tree.children[0].bind = { text: { from: 'entry', path: 'title' } };
    });
    expect(validateComposedSpec(s)).toEqual([]);
  });

  it('rejects a CollectionList inside a CollectionList at any depth', () => {
    const s = mut(questions(), (x) => x.tree.children[1].children.push({ el: 'Box', children: [list('inner')] }));
    expect(paths(s)).toEqual(['tree.children.1.children.1.children.0.el']);
    const direct = mut(questions(), (x) => x.tree.children[1].children.push(list('inner')));
    expect(paths(direct)).toEqual(['tree.children.1.children.1.el']);
  });

  it('rejects more than 4 lists', () => {
    const s = mut(questions(), (x) => x.tree.children.push(list('list2'), list('list3'), list('list4'), list('list5')));
    expect(paths(s)).toEqual(['tree.children.6.el']);
    const four = mut(questions(), (x) => x.tree.children.push(list('list2'), list('list3'), list('list4')));
    expect(validateComposedSpec(four)).toEqual([]);
  });

  it('rejects duplicate, malformed and clashing keys', () => {
    expect(paths(mut(questions(), (x) => x.tree.children.push(list('list'))))).toEqual(['tree.children.3.props.key']);
    expect(paths(mut(questions(), (x) => (x.tree.children[1].props.key = 'List')))).toEqual(['tree.children.1.props.key']);
    expect(paths(mut(questions(), (x) => (x.tree.children[1].props.key = 'a'.repeat(33))))).toEqual(['tree.children.1.props.key']);
    expect(paths(mut(questions(), (x) => (x.tree.children[1].props.key = 'title')))).toEqual(['tree.children.1.props.key']);
    expect(paths(mut(questions(), (x) => (x.tree.children[1].props.key = 'entries')))).toEqual(['tree.children.1.props.key']);
    expect(paths(mut(questions(), (x) => (x.tree.children[1].props.key = 'slot2')))).toEqual(['tree.children.1.props.key']);
    expect(paths(mut(questions(), (x) => (x.tree.children[1].props.key = 'constructor')))).toEqual(['tree.children.1.props.key']);
    expect(paths(mut(questions(), (x) => delete x.tree.children[1].props.key))).toEqual(['tree.children.1.props.key']);
  });

  it('reserves the key region (its <key>__layout field would be region__layout, a Region slot name)', () => {
    const s = mut(questions(), (x) => (x.tree.children[1].props = { key: 'region', apiId: 'question', editor: { layout: true } }));
    expect(validateComposedSpec(s)).toEqual([{ path: ['tree', 'children', 1, 'props', 'key'], message: '"region" is reserved' }]);
    expect(validateComposedSpec(mut(questions(), (x) => (x.tree.children[1].props.key = 'regions')))).toEqual([]);
  });

  it('rejects a CollectionList in a collection-bound block', () => {
    const s = mut(questions(), (x) => {
      x.binding = { apiId: 'product', mode: 'collection' };
      x.tree.children[1].children[0].bind = {};
    });
    expect(paths(s)).toEqual(['tree.children.1.el']);
  });

  it('checks the query props', () => {
    const at = (p: Record<string, unknown>) => paths(mut(questions(), (x) => Object.assign(x.tree.children[1].props, p)));
    expect(at({ limit: 51 })).toEqual(['tree.children.1.props.limit']);
    expect(at({ limit: 0 })).toEqual(['tree.children.1.props.limit']);
    expect(at({ apiId: '' })).toEqual(['tree.children.1.props.apiId']);
    expect(at({ layout: { kind: 'grid', columns: 1 } })).toEqual(['tree.children.1.props.layout.columns']);
    expect(at({ layout: { kind: 'grid', columns: 7 } })).toEqual(['tree.children.1.props.layout.columns']);
    expect(at({ layout: { kind: 'carousel', columns: 7 } })).toEqual(['tree.children.1.props.layout.columns']);
    expect(at({ layout: { kind: 'masonry' } })).toEqual(['tree.children.1.props.layout.kind']);
    expect(at({ filter: [{ field: 'a', value: { x: 1 } }] })).toEqual(['tree.children.1.props.filter.0.value']);
    expect(at({ sort: { field: 'a', direction: 'up' } })).toEqual(['tree.children.1.props.sort.direction']);
    expect(at({ emptyText: { 'vi-VN': 'x' } })).toEqual(['tree.children.1.props.emptyText.en-US']);
    expect(at({ urlPattern: '' })).toEqual(['tree.children.1.props.urlPattern']);
    expect(at({ editor: { filter: 'yes' } })).toEqual(['tree.children.1.props.editor.filter']);
    expect(at({ editor: { columns: true } })).toEqual(['tree.children.1.props.editor.columns']);
    expect(at({ color: 'red' })).toEqual(['tree.children.1.props.color']);
  });

  it('applies the item template rules inside the list', () => {
    const inList = (n: ComposedNode) => paths(mut(questions(), (x) => x.tree.children[1].children.push(n)));
    expect(inList({ el: 'Slot' })).toEqual(['tree.children.1.children.1.el']);
    expect(inList({ el: 'Carousel', children: [{ el: 'Box' }] })).toEqual(['tree.children.1.children.1.el']);
    expect(inList({ el: 'Region', props: { name: 'main' } })).toEqual(['tree.children.1.children.1.el']);
    // Outside the list a Slot and a Carousel stay allowed.
    expect(validateComposedSpec(mut(questions(), (x) => x.tree.children.push({ el: 'Slot' })))).toEqual([]);
  });

  it('resolves entryUrl from the list urlPattern or the type detail page', () => {
    // Without type context the pure validator accepts entryUrl (a detail page may apply).
    expect(validateComposedSpec(questions())).toEqual([]);
    expect(paths(questions(), { detailTypes: new Set() })).toEqual(['tree.children.1.children.0.bind.href']);
    expect(validateComposedSpec(questions(), { detailTypes: new Set(['question']) })).toEqual([]);
    const withPattern = mut(questions(), (x) => (x.tree.children[1].props.urlPattern = '/q/{slug}'));
    expect(validateComposedSpec(withPattern, { detailTypes: new Set() })).toEqual([]);
    // The block's urlPattern never applies to lists.
    const blockPattern = mut(questions(), (x) => (x.binding = { apiId: 'product', mode: 'single', urlPattern: '/p/{slug}' }));
    expect(paths(blockPattern, { detailTypes: new Set() })).toEqual(['tree.children.1.children.0.bind.href']);
  });

  it('applies the detail-page fallback to block-level bindings', () => {
    const s: ComposedBlockSpec = {
      ...questions(), binding: { apiId: 'product', mode: 'collection' },
      tree: { el: 'Card', bind: { href: { from: 'entryUrl' } } },
    };
    expect(validateComposedSpec(s)).toEqual([]);
    expect(paths(s, { detailTypes: new Set(['question']) })).toEqual(['tree.bind.href']);
    expect(validateComposedSpec(s, { detailTypes: new Set(['product']) })).toEqual([]);
  });
});

describe('collectionListsOf', () => {
  it('lists the CollectionLists in tree order with their keys', () => {
    const s = mut(questions(), (x) => x.tree.children.push({ el: 'Box', children: [list('more')] }));
    const out = collectionListsOf(s);
    expect(out.map((l) => l.key)).toEqual(['list', 'more']);
    expect(out[1].node.props?.apiId).toBe('question');
    expect(collectionListsOf({ tree: { el: 'Box' } } as ComposedBlockSpec)).toEqual([]);
  });
});

describe('generated list field names (grandfathered)', () => {
  const old = (): ComposedBlockSpec => mut(questions(), (x) => {
    x.fields.list = { kind: 'text' };
    x.tree.children.splice(1, 1);
  });
  it('keeps a manual field named list valid when no list uses the key', () => {
    expect(composedFieldNameIssue('list')).toBeNull();
    expect(composedFieldNameIssue('list2')).toBeNull();
    expect(validateComposedSpec(old())).toEqual([]);
  });
  it('reports a clashing list key on the key, never on the field', () => {
    const s = mut(old(), (x) => x.tree.children.push(list('list')));
    expect(validateComposedSpec(s)).toEqual([{ path: ['tree', 'children', 2, 'props', 'key'], message: 'key collides with field "list"' }]);
    expect(validateComposedSpec(mut(old(), (x) => x.tree.children.push(list('list2'))))).toEqual([]);
  });
});

describe('isBreakingChange with lists', () => {
  it('is breaking when a list key is removed or its type changes', () => {
    const a = questions();
    expect(isBreakingChange(a, mut(a, (x) => x.tree.children.push(list('list2'))))).toBe(false);
    expect(isBreakingChange(a, mut(a, (x) => (x.tree.children[1].props.key = 'faqs')))).toBe(true);
    expect(isBreakingChange(a, mut(a, (x) => (x.tree.children[1].props.apiId = 'product')))).toBe(true);
    expect(isBreakingChange(a, mut(a, (x) => (x.tree.children[1].props.limit = 4)))).toBe(false);
  });
});
