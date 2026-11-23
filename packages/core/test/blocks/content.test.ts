import { describe, expect, it } from 'vitest';
import { PUCK_FORMAT_VERSION, b, collectBlockNames, defineBlock, defineBlocks, readPageContent, writePageContent } from '../../blocks/src';
import { collectBlockNames as schemaCollect } from '@opencloudcms/schema';

const EMPTY = { root: { props: {} }, content: [], zones: {} };

const Card = defineBlock({
  name: 'Card',
  label: 'Card',
  category: 'basic',
  version: 2,
  migrate: [{ from: 1, up: ({ title, ...rest }) => ({ ...rest, heading: title }) }],
  fields: { heading: b.text(), body: b.slot() },
  render: () => null,
});
const Heading = defineBlock({ name: 'Heading', label: 'Heading', category: 'basic', fields: { text: b.text() }, render: () => null });
const Faq = defineBlock({
  name: 'Faq',
  label: 'FAQ',
  category: 'marketing',
  version: 3,
  migrate: [
    { from: 1, up: (p) => ({ ...p, step1: true }) },
    { from: 2, up: (p) => ({ ...p, step2: true }) },
  ],
  fields: { items: b.list({ q: b.text(), a: b.slot() }), step1: b.boolean(), step2: b.boolean() },
  render: () => null,
});
const r = defineBlocks([Card, Heading, Faq]);
const stored = (data: unknown, formatVersion = PUCK_FORMAT_VERSION) => ({ format: 'puck', formatVersion, data });

describe('readPageContent', () => {
  it('treats null, undefined, {} and non-objects as empty', () => {
    for (const raw of [null, undefined, {}, 'x', 3, []]) {
      expect(readPageContent(raw, r)).toEqual({ status: 'empty', data: EMPTY });
    }
  });

  it('reports needs-migration for another formatVersion and leaves data untouched', () => {
    const data = { root: { props: {} }, content: [{ type: 'Card', props: { id: 'c1', title: 'Old', _v: 1 } }] };
    const raw = stored(data, PUCK_FORMAT_VERSION - 1);
    const out = readPageContent(raw, r);
    expect(out.status).toBe('needs-migration');
    expect(out.data).toBe(data);
    expect(data.content[0].props).toEqual({ id: 'c1', title: 'Old', _v: 1 });
  });

  it('reports needs-migration for an unrecognised shape', () => {
    expect(readPageContent({ root: {}, content: [] }, r).status).toBe('needs-migration');
  });

  it('migrates props from an older block version, also inside slots and list rows', () => {
    const raw = stored({
      root: { props: { title: 'Page' } },
      content: [
        {
          type: 'Card',
          props: { id: 'c1', title: 'Old', _v: 1, body: [{ type: 'Card', props: { id: 'c2', title: 'Inner', _v: 1, body: [] } }] },
        },
        { type: 'Faq', props: { id: 'f1', _v: 1, items: [{ q: 'Q', a: [{ type: 'Card', props: { id: 'c3', title: 'Deep', _v: 1 } }] }] } },
      ],
    });
    const out = readPageContent(raw, r);
    expect(out.status).toBe('ok');
    expect(out.data.root).toEqual({ props: { title: 'Page' } });
    expect(out.data.content[0].props).toEqual({
      id: 'c1',
      _v: 2,
      heading: 'Old',
      body: [{ type: 'Card', props: { id: 'c2', _v: 2, heading: 'Inner', body: [] } }],
    });
    expect(out.data.content[1].props).toEqual({
      id: 'f1',
      _v: 3,
      step1: true,
      step2: true,
      items: [{ q: 'Q', a: [{ type: 'Card', props: { id: 'c3', _v: 2, heading: 'Deep' } }] }],
    });
  });

  it('treats a missing _v as version 1 and does not touch current props', () => {
    const raw = stored({ root: { props: {} }, content: [{ type: 'Card', props: { id: 'c1', title: 'Old' } }, { type: 'Heading', props: { id: 'h1', text: 'T', _v: 1 } }] });
    const out = readPageContent(raw, r);
    expect(out.data.content[0].props).toEqual({ id: 'c1', _v: 2, heading: 'Old' });
    expect(out.data.content[1].props).toEqual({ id: 'h1', text: 'T', _v: 1 });
  });

  it('keeps unknown blocks as-is', () => {
    const ghost = { type: 'Ghost', props: { id: 'g1', anything: [{ type: 'Card', props: { id: 'x', title: 't', _v: 1 } }], _v: 7 } };
    const out = readPageContent(stored({ root: { props: {} }, content: [ghost], zones: { 'g1:z': [ghost] } }), r);
    expect(out.status).toBe('ok');
    expect(out.data.content[0]).toEqual(ghost);
    expect(out.data.zones).toEqual({ 'g1:z': [ghost] });
  });

  it('does not mutate its input', () => {
    const raw = stored({ root: { props: {} }, content: [{ type: 'Card', props: { id: 'c1', title: 'Old', _v: 1 } }] });
    const copy = JSON.parse(JSON.stringify(raw));
    readPageContent(raw, r);
    expect(raw).toEqual(copy);
  });
});

describe('writePageContent', () => {
  const data = {
    root: { props: { title: 'Page' } },
    content: [
      {
        type: 'Card',
        props: {
          id: 'c1',
          heading: 'Hi',
          stray: 1,
          body: [{ type: 'Heading', props: { id: 'h1', text: 'T', junk: true } }],
        },
      },
      { type: 'Faq', props: { id: 'f1', items: [{ q: 'Q', extra: 'x', a: [] }], step1: false } },
      { type: 'Ghost', props: { id: 'g1', whatever: 1 } },
    ],
  };

  it('wraps data with format and formatVersion, strips undeclared props and stamps _v', () => {
    const out = writePageContent(data as any, r);
    expect(out.format).toBe('puck');
    expect(out.formatVersion).toBe(PUCK_FORMAT_VERSION);
    expect(out.data.root).toEqual({ props: { title: 'Page' } });
    expect(out.data.content).toEqual([
      { type: 'Card', props: { id: 'c1', _v: 2, heading: 'Hi', body: [{ type: 'Heading', props: { id: 'h1', _v: 1, text: 'T' } }] } },
      { type: 'Faq', props: { id: 'f1', _v: 3, items: [{ q: 'Q', a: [] }], step1: false } },
      { type: 'Ghost', props: { id: 'g1', whatever: 1 } },
    ]);
    expect('zones' in out.data).toBe(false);
  });

  it('keeps Puck item keys such as readOnly and walks zones', () => {
    const out = writePageContent(
      { root: { props: {} }, content: [], zones: { 'c1:z': [{ type: 'Heading', props: { id: 'h', text: 'a', no: 1 }, readOnly: { text: true } }] } } as any,
      r,
    );
    expect(out.data.zones).toEqual({ 'c1:z': [{ type: 'Heading', props: { id: 'h', _v: 1, text: 'a' }, readOnly: { text: true } }] });
  });

  it('round-trips: read(write(x)) equals x minus undeclared props', () => {
    const x = {
      root: { props: {} },
      content: [
        { type: 'Card', props: { id: 'c1', _v: 2, heading: 'Hi', body: [{ type: 'Heading', props: { id: 'h1', _v: 1, text: 'T' } }] } },
        { type: 'Faq', props: { id: 'f1', _v: 3, items: [{ q: 'Q', a: [] }], step1: true, step2: false } },
      ],
    };
    const dirty = JSON.parse(JSON.stringify(x));
    dirty.content[0].props.stray = 'x';
    dirty.content[0].props.body[0].props.junk = 1;
    dirty.content[1].props.items[0].extra = 2;
    const back = readPageContent(JSON.parse(JSON.stringify(writePageContent(dirty, r))), r);
    expect(back.status).toBe('ok');
    expect(back.data).toEqual(x);
  });
});

describe('re-exports', () => {
  it('collectBlockNames is the schema implementation', () => {
    expect(collectBlockNames).toBe(schemaCollect);
  });
});
