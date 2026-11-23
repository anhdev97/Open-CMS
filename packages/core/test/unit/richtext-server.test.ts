import { describe, expect, it } from 'vitest';
import { normalizeRichText as blocksNormalize } from '../../blocks/src/richtext';
import { normalizeRichText, normalizeStoredRichText } from '../../src/pages/richtext';
import { createPageHooks } from '../../src/pages/page.hooks';

const EVIL = '<img src=x onerror="alert(1)"><a href="javascript:alert(2)">x</a>';
const CORPUS = [
  EVIL,
  '<p>a <strong>b</strong> <em>c</em> <u>d</u> <s>e</s> <code>f</code><br>g</p>',
  '<h3 style="text-align:right" class="x">T</h3><ul><li><p>i</p></li></ul><ol><li><p>j</p></li></ol>',
  '<blockquote><p>q</p></blockquote><hr><pre><code>k</code></pre><p><a href="https://example.com" target="_blank">l</a></p>',
  '<script>alert(1)</script><iframe src="https://evil"></iframe><svg onload=alert(1)></svg>',
  'plain < text & more',
];

describe('server rich text normalizer', () => {
  it('matches the blocks normalizer (same schema) on a corpus', () => {
    for (const html of CORPUS) expect(normalizeRichText(html)).toBe(blocksNormalize(html));
  });

  it('normalizes the manifest richText paths in content, zones, slots and list rows only', () => {
    const manifest = [
      { name: 'Text', version: 1, richText: ['content'] },
      { name: 'Faq', version: 1, richText: ['rows[].answer'] },
      { name: 'Section', version: 1 },
    ];
    const text = (id: string) => ({ type: 'Text', props: { id, content: EVIL, align: 'left' } });
    const content = {
      format: 'puck',
      formatVersion: 24,
      data: {
        root: { props: { title: EVIL } },
        content: [
          text('t1'),
          { type: 'Section', props: { id: 's1', children: [text('t2')] } },
          { type: 'Faq', props: { id: 'f1', rows: [{ question: EVIL, answer: EVIL, inner: [text('t3')] }] } },
          { type: 'Ghost', props: { id: 'g1', content: EVIL } },
        ],
        zones: { 's1:z': [text('t4')] },
      },
    };
    const out = normalizeStoredRichText(content, manifest) as typeof content;
    const clean = normalizeRichText(EVIL);
    const c = out.data.content as any[];
    expect(c[0].props).toEqual({ id: 't1', content: clean, align: 'left' });
    expect(c[1].props.children[0].props.content).toBe(clean);
    expect(c[2].props.rows[0]).toEqual({ question: EVIL, answer: clean, inner: [{ type: 'Text', props: { id: 't3', content: clean, align: 'left' } }] });
    expect(c[3].props.content).toBe(EVIL); // unknown block: untouched
    expect((out.data.zones as any)['s1:z'][0].props.content).toBe(clean);
    expect(out.data.root).toEqual({ props: { title: EVIL } });
    expect(content.data.content[0]).toEqual(text('t1')); // input not mutated
  });

  it('page hooks normalize content on create and update only with a manifest', async () => {
    const data = { title: 'T', content: { format: 'puck', formatVersion: 24, data: { root: {}, content: [{ type: 'Text', props: { content: EVIL } }] } } };
    const hooks = createPageHooks([{ name: 'Text', version: 1, richText: ['content'] }]);
    for (const h of [hooks.beforeCreate!, hooks.beforeUpdate!]) {
      const r = (await h(data, {} as never)) as typeof data;
      expect(JSON.stringify(r)).not.toMatch(/onerror|javascript:/);
      expect(r.title).toBe('T');
    }
    expect(await createPageHooks(undefined).beforeCreate!(data, {} as never)).toBe(data);
  });
});
