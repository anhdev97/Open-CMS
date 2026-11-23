import { describe, expect, it } from 'vitest';
import { coreBlocks, defineBlocks, normalizePageRichText, normalizeRichText, readPageContent } from '../../blocks/src';

const EVIL = '<img src=x onerror="alert(1)"><a href="javascript:alert(2)">x</a>';

describe('normalizeRichText', () => {
  it('drops event handlers, unknown tags and javascript: links', () => {
    const out = normalizeRichText(EVIL);
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('javascript:');
    expect(out).toBe('<p>x</p>'); // the javascript: link mark is dropped, its text is kept
    for (const href of ['JaVaScRiPt:alert(1)', ' java\tscript:alert(1)', '&#106;avascript:alert(1)', 'data:text/html,<script>alert(1)</script>']) {
      expect(normalizeRichText(`<p><a href="${href}">l</a></p>`)).toBe('<p>l</p>');
    }
    expect(normalizeRichText('<p>a<script>alert(1)</script>b</p><style>p{}</style>')).not.toMatch(/<script|<style/);
    expect(normalizeRichText('<p onclick="x()" style="color:red;text-align:center">t</p>')).toBe('<p style="text-align: center;">t</p>');
  });

  it('keeps what the rich text editor produces', () => {
    const html =
      '<h2>T</h2><p>a <strong>b</strong> <em>c</em> <u>d</u> <s>e</s> <code>f</code><br>g</p><ul><li><p>i</p></li></ul><ol><li><p>j</p></li></ol><blockquote><p>q</p></blockquote><hr><pre><code>k</code></pre>';
    const out = normalizeRichText(html);
    for (const tag of ['<h2>', '<strong>', '<em>', '<u>', '<s>', '<code>', '<br>', '<ul>', '<ol>', '<blockquote>', '<hr>', '<pre>']) expect(out).toContain(tag);
    expect(normalizeRichText('<p><a href="https://example.com">l</a></p>')).toContain('href="https://example.com"');
  });

  it('is idempotent; plain text becomes an escaped paragraph; non-strings become empty', () => {
    const once = normalizeRichText(EVIL);
    expect(normalizeRichText(once)).toBe(once);
    expect(normalizeRichText('a < b & c')).toBe('<p>a &lt; b &amp; c</p>');
    expect(normalizeRichText('')).toBe('');
    expect(normalizeRichText(null)).toBe('');
    expect(normalizeRichText({ html: EVIL })).toBe('');
  });
});

describe('page data', () => {
  const r = defineBlocks(coreBlocks);
  const text = (content: unknown, id = 't1') => ({ type: 'Text', props: { id, _v: 1, content, align: 'left' } });
  const section = (...children: unknown[]) => ({ type: 'Section', props: { id: 's1', _v: 1, background: 'muted', paddingY: '12', children } });

  it('readPageContent normalizes richText props, also inside slots', () => {
    const raw = { format: 'puck', formatVersion: 24, data: { root: { props: {} }, content: [text(EVIL), section(text(EVIL, 't2'))] } };
    const { status, data } = readPageContent(raw, r);
    expect(status).toBe('ok');
    const s = JSON.stringify(data);
    expect(s).not.toContain('onerror');
    expect(s).not.toContain('javascript:');
  });

  it('normalizePageRichText leaves other props and unknown blocks alone', () => {
    const data = { root: { props: {} }, content: [text(EVIL), { type: 'Ghost', props: { id: 'g', content: EVIL } }] } as never;
    const out = normalizePageRichText(data, r) as unknown as { content: { props: Record<string, unknown> }[] };
    expect(out.content[0].props.align).toBe('left');
    expect(out.content[0].props.content).not.toContain('onerror');
    expect(out.content[1].props.content).toBe(EVIL);
  });
});
