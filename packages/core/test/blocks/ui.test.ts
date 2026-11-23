import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ui } from '../../blocks/src';
import { GRID_N } from '../../blocks/src/ui/tokens';
import { safeHref } from '../../blocks/src/ui/href';
import { LinkButton } from '../../blocks/src/library/ui';

const r = (el: any) => renderToString(el);

describe('ui primitives', () => {
  it('Grid columns 4 uses the literal lookup class', () => {
    expect(r(h(ui.Grid, { columns: 4 }, 'x'))).toContain(GRID_N[4]);
    expect(GRID_N[4]).toContain('lg:grid-cols-4');
  });
  it('Heading level maps to the tag', () => {
    expect(r(h(ui.Heading, { level: 3, text: 'Hi' }))).toMatch(/^<h3/);
  });
  it('Text sanitizes html', () => {
    const out = r(h(ui.Text, { html: '<p>ok</p><img src=x onerror=1>' }));
    expect(out).not.toContain('onerror');
    expect(out).toContain('ok');
  });
  it('Text renders plain text', () => {
    expect(r(h(ui.Text, { text: 'a<b' }))).toContain('a&lt;b');
  });
  it('Image with null src renders nothing', () => {
    expect(r(h(ui.Image, { src: null }))).toBe('');
  });
  it('Image renders img', () => {
    expect(r(h(ui.Image, { src: '/a.png', alt: 'A', ratio: 'video' }))).toContain('aspect-video');
  });
  it('Button href null renders span, else anchor', () => {
    expect(r(h(ui.Button, { label: 'Go', href: null }))).toMatch(/^<span/);
    expect(r(h(ui.Button, { label: 'Go', href: '/x' }))).toMatch(/^<a/);
  });
  it('Badge, Divider, Spacer, Box, Stack, Columns, Card render', () => {
    expect(r(h(ui.Badge, { text: 'New' }))).toContain('New');
    expect(r(h(ui.Divider, {}))).toContain('<hr');
    expect(r(h(ui.Spacer, { size: '8' }))).toContain('h-8');
    expect(r(h(ui.Box, { padding: '4', background: 'muted' }, 'c'))).toContain('py-4');
    expect(r(h(ui.Stack, { direction: 'horizontal', gap: '2', align: 'center' }, 'c'))).toContain('flex-row');
    expect(r(h(ui.Columns, { count: 3 }, 'c'))).toContain('md:grid-cols-3');
    expect(r(h(ui.Card, { bordered: false }, 'c'))).toContain('data-slot="card"');
  });
  it('Price uses Intl.NumberFormat', () => {
    const exp = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(1200000);
    expect(r(h(ui.Price, { value: 1200000, locale: 'vi-VN', currency: 'VND' })).replace(/&nbsp;/g, ' ')).toContain(exp);
    expect(r(h(ui.Price, { value: 1234.5, locale: 'en-US' }))).toContain(new Intl.NumberFormat('en-US').format(1234.5));
    expect(r(h(ui.Price, { value: null as any, locale: 'en-US' }))).toBe('');
  });
  it('DateText uses dateStyle', () => {
    const d = '2026-11-23T10:00:00Z';
    for (const f of ['short', 'long'] as const) {
      expect(r(h(ui.DateText, { value: d, locale: 'en-US', format: f }))).toContain(
        new Intl.DateTimeFormat('en-US', { dateStyle: f, timeZone: 'UTC' }).format(new Date(d)),
      );
    }
    expect(r(h(ui.DateText, { value: 'nope', locale: 'en-US', format: 'short' }))).toBe('');
  });
  it('DateText timeZone: datetime in the given zone (default UTC); date-only strings always UTC', () => {
    const at = '2026-11-23T02:00:00+07:00';
    expect(r(h(ui.DateText, { value: at, locale: 'en-US', format: 'long', timeZone: 'Asia/Ho_Chi_Minh' }))).toContain('November 23, 2026');
    expect(r(h(ui.DateText, { value: at, locale: 'en-US', format: 'long' }))).toContain('November 22, 2026');
    expect(r(h(ui.DateText, { value: '2026-11-23', locale: 'en-US', format: 'long', timeZone: 'America/Los_Angeles' }))).toContain('November 23, 2026');
  });
  it('safeHref allows http(s), mailto, tel, /path, #hash, ?query only', () => {
    for (const ok of ['https://a.example/x', 'http://a', 'mailto:a@b.c', 'tel:+84123', '/products/a', '#top', '?q=1', ' /trim ']) {
      expect(safeHref(ok)).toBe(ok.trim());
    }
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:x', '//evil.com', '/\\evil.com', 'data:text/html,x', 'vbscript:x', 'relative/path', '', '  ', null, undefined, 42, {}]) {
      expect(safeHref(bad)).toBeNull();
    }
  });
  it('Button and LinkButton render unsafe hrefs as a span', () => {
    for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', '//evil.com']) {
      expect(r(h(ui.Button, { label: 'Go', href }))).toMatch(/^<span/);
      expect(r(h(LinkButton, { label: 'Go', href }))).toMatch(/^<span/);
    }
    expect(r(h(LinkButton, { label: 'Go', href: 'https://a.example' }))).toContain('href="https://a.example"');
  });
  it('unknown tokens fall back to defaults, never "undefined"', () => {
    const out = [
      r(h(ui.Box, { padding: 'zzz' as any, background: 'zzz' as any }, 'c')),
      r(h(ui.Stack, { direction: 'vertical', gap: 'zzz' as any, align: 'zzz' as any }, 'c')),
      r(h(ui.Grid, { columns: 99 as any }, 'c')),
      r(h(ui.Columns, { count: 9 as any }, 'c')),
      r(h(ui.Heading, { level: 9 as any, text: 'x', align: 'zzz' as any })),
      r(h(ui.Text, { text: 'x', size: 'zzz' as any, color: 'zzz' as any })),
      r(h(ui.Button, { label: 'x', href: '/a', variant: 'zzz' as any, size: 'zzz' as any })),
      r(h(ui.Badge, { text: 'x', variant: 'zzz' as any })),
      r(h(ui.Spacer, { size: 'zzz' as any })),
      r(h(ui.Image, { src: '/a', ratio: 'zzz' as any })),
    ].join('');
    expect(out).not.toContain('undefined');
  });
});
