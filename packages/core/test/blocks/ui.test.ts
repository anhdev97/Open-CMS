import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ui } from '../../blocks/src';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BORDER_SIDE, FLEX_WRAP, GRID_N, HIDE, IMAGE_ASPECT, OBJECT_FIT, SHOW, STACK_ALIGN_BP, STACK_DIRECTION, STACK_JUSTIFY, STYLE_CLASS, STYLE_SINGLE,
} from '../../blocks/src/ui/tokens';
import { cssColor, cssLength, cssTracks, styleProps } from '../../blocks/src/ui/style';
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
  it('safeHref ignores tab/CR/LF like browsers do (no //host smuggling)', () => {
    for (const bad of ['/\t/evil.com', '/\n/evil.com', '/\r/evil.com', '/\t\\evil.com', '\t//evil.com', 'java\nscript:x', '/\n\t/evil.com']) {
      expect(safeHref(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(safeHref('/pro\nducts')).toBe('/products');
    expect(safeHref('ht\ttps://a.example')).toBe('https://a.example');
    expect(r(h(LinkButton, { label: 'Go', href: '/\t/evil.com' }))).toMatch(/^<span/);
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

describe('ui.layoutClass', () => {
  it('gives the exact class of each layout primitive (used by the block builder canvas drop zones)', () => {
    const cls = (el: unknown) => /class="([^"]*)"/.exec(r(el as never))![1];
    expect(ui.layoutClass.Box({ padding: '12', background: 'muted' })).toBe(cls(h(ui.Box, { padding: '12', background: 'muted' })));
    expect(ui.layoutClass.Stack({ direction: 'horizontal', gap: '2', align: 'center' })).toBe(cls(h(ui.Stack, { direction: 'horizontal', gap: '2', align: 'center' })));
    expect(ui.layoutClass.Columns({ count: 3 })).toBe(cls(h(ui.Columns, { count: 3 })));
    expect(ui.layoutClass.Grid({ columns: 5, gap: '8' })).toBe(cls(h(ui.Grid, { columns: 5, gap: '8' })));
    expect(ui.layoutClass.Card({ bordered: false })).toBe(cls(h(ui.Card, { bordered: false })));
  });
});

describe('styleProps', () => {
  it('empty style → nothing', () => {
    expect(styleProps(undefined)).toEqual({ className: '', style: {} });
    expect(styleProps({})).toEqual({ className: '', style: {} });
  });
  it('custom padding side → variable + literal class', () => {
    const sp = styleProps({ padding: { t: '37px' } });
    expect(sp.className).toContain('pt-(--ocms-pt)');
    expect(sp.style).toEqual({ '--ocms-pt': '37px' });
  });
  it('responsive padding at md', () => {
    const sp = styleProps({ padding: { md: { l: '5%' } } });
    expect(sp.className).toBe('md:pl-(--ocms-pl-md)');
    expect(sp.style).toEqual({ '--ocms-pl-md': '5%' });
  });
  it('spacing token renders through --spacing', () => {
    expect(styleProps({ margin: { b: '8' } }).style).toEqual({ '--ocms-mb': 'calc(var(--spacing) * 8)' });
    expect(cssLength('8')).toBe('calc(var(--spacing) * 8)');
    expect(cssLength('auto')).toBe('auto');
    expect(cssLength('12px')).toBe('12px');
  });
  it('margin allows negative and auto, padding does not', () => {
    expect(styleProps({ margin: { l: 'auto', t: '-4px' } }).style).toEqual({ '--ocms-ml': 'auto', '--ocms-mt': '-4px' });
    expect(styleProps({ padding: { l: 'auto', t: '-4px' } })).toEqual({ className: '', style: {} });
  });
  it('colors: brand, token, hex', () => {
    expect(styleProps({ background: 'brand:accent' })).toEqual({ className: 'bg-(--ocms-bg)', style: { '--ocms-bg': 'var(--ocms-color-accent)' } });
    expect(cssColor('muted')).toBe('var(--color-muted)');
    expect(cssColor('#fff')).toBe('#fff');
    expect(styleProps({ color: '#112233' })).toEqual({ className: 'text-(--ocms-fg)', style: { '--ocms-fg': '#112233' } });
  });
  it('invalid values emit nothing (no CSS injection)', () => {
    for (const s of [
      { color: 'red;x' }, { background: 'brand:Bad' }, { padding: { t: '1px;}' } }, { width: 'calc(1px)' },
      { radius: 'url(x)' }, { borderWidth: '1px;x' }, { span: 13 }, { hidden: { md: 'yes' } }, { maxWidth: 'auto' },
    ] as any[]) {
      expect(styleProps(s), JSON.stringify(s)).toEqual({ className: '', style: {} });
    }
  });
  it('sizes', () => {
    const sp = styleProps({ width: { base: '100%', lg: '50%' }, maxWidth: '640px', height: '100%', minHeight: '4' });
    expect(sp.className.split(' ').sort()).toEqual(['h-(--ocms-h)', 'lg:w-(--ocms-w-lg)', 'max-w-(--ocms-maxw)', 'min-h-(--ocms-minh)', 'w-(--ocms-w)'].sort());
    expect(sp.style).toEqual({ '--ocms-w': '100%', '--ocms-w-lg': '50%', '--ocms-maxw': '640px', '--ocms-h': '100%', '--ocms-minh': 'calc(var(--spacing) * 4)' });
  });
  it('border and radius', () => {
    const sp = styleProps({ borderWidth: '1', borderColor: 'brand:line', borderSides: ['b'], radius: 'lg' });
    expect(sp.className.split(' ').sort()).toEqual(['border-(--ocms-bc)', 'border-b-(length:--ocms-bw)', 'rounded-(--ocms-r)'].sort());
    expect(sp.style).toEqual({ '--ocms-bw': '1px', '--ocms-bc': 'var(--ocms-color-line)', '--ocms-r': 'var(--radius-lg)' });
    const all = styleProps({ borderWidth: '3px', radius: 'full' });
    expect(all.className).toContain('border-t-(length:--ocms-bw)');
    expect(all.className).toContain('border-l-(length:--ocms-bw)');
    expect(all.style).toEqual({ '--ocms-bw': '3px', '--ocms-r': '9999px' });
    expect(styleProps({ radius: 'none' }).style).toEqual({ '--ocms-r': '0' });
  });
  it('hidden restores the element display where not hidden', () => {
    expect(styleProps({ hidden: { md: true } }, 'flex').className).toBe('flex md:hidden lg:flex');
    expect(styleProps({ hidden: { base: true } }).className).toBe('hidden md:block lg:block');
    expect(styleProps({ hidden: { lg: true } }, 'grid').className).toBe('grid md:grid lg:hidden');
    expect(styleProps({ hidden: { md: false } }).className).toBe('');
  });
  it('span', () => {
    const sp = styleProps({ span: { base: 'full', md: 1 } });
    expect(sp.className).toBe('col-span-full md:col-span-(--ocms-span-md)');
    expect(sp.style).toEqual({ '--ocms-span-md': '1' });
  });
  it('cssTracks', () => {
    expect(cssTracks(['2fr', '3fr'])).toBe('2fr 3fr');
    expect(cssTracks(['auto', '1fr', 'auto'])).toBe('auto 1fr auto');
    expect(cssTracks(['240px', '4', '1fr'])).toBe('240px calc(var(--spacing) * 4) 1fr');
  });
});

describe('style-aware primitives', () => {
  const cls = (html: string) => /class="([^"]*)"/.exec(html)?.[1];
  it('old props without style render byte-identical output', () => {
    expect([
      r(h(ui.Box, { padding: '8' }, 'c')),
      r(h(ui.Box, { background: 'muted' }, 'c')),
      r(h(ui.Stack, { direction: 'horizontal', gap: '2', align: 'center' }, 'c')),
      r(h(ui.Stack, { direction: 'vertical' }, 'c')),
      r(h(ui.Columns, { count: 3, gap: '4' }, 'c')),
      r(h(ui.Grid, { columns: 4 }, 'c')),
      r(h(ui.Card, { padding: '4', background: 'muted' }, 'c')),
      r(h(ui.Heading, { level: 2, text: 'T', align: 'center' })),
      r(h(ui.Text, { text: 'T', size: 'sm', color: 'muted' })),
      r(h(ui.Image, { src: '/a.png', alt: 'A', ratio: 'video', rounded: true })),
      r(h(ui.Button, { label: 'Go', href: '/x', variant: 'outline' })),
      r(h(ui.Badge, { text: 'N' })),
      r(h(ui.Price, { value: 5, locale: 'en-US' })),
      r(h(ui.DateText, { value: '2026-01-02', locale: 'en-US', format: 'short' })),
      r(h(ui.Divider, {})),
      r(h(ui.Spacer, { size: '4' })),
    ]).toEqual([
      '<div class="py-8">c</div>',
      '<div class="py-8 bg-muted text-foreground">c</div>',
      '<div class="flex flex-row flex-wrap gap-2 items-center">c</div>',
      '<div class="flex flex-col gap-4 items-stretch">c</div>',
      '<div class="grid grid-cols-1 md:grid-cols-3 gap-4">c</div>',
      '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">c</div>',
      '<div data-slot="card" class="flex flex-col gap-4 overflow-hidden rounded-xl shadow-xs border bg-muted text-foreground p-4">c</div>',
      '<h2 class="text-3xl font-semibold tracking-tight text-center">T</h2>',
      '<p class="text-sm text-muted-foreground">T</p>',
      '<img src="/a.png" alt="A" loading="lazy" class="w-full object-cover aspect-video rounded-xl"/>',
      '<a data-slot="button" href="/x" class="inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background border bg-background text-foreground shadow-xs hover:bg-accent hover:text-accent-foreground h-9 px-4 py-2">Go</a>',
      '<span data-slot="badge" class="inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap border-transparent bg-primary text-primary-foreground">N</span>',
      '<span>5</span>',
      '<time dateTime="2026-01-02T00:00:00.000Z">1/2/26</time>',
      '<hr class="my-6 border-border"/>',
      '<div aria-hidden="true" class="h-4"></div>',
    ]);
  });
  it('Box style padding replaces the padding token; background replaces BG', () => {
    const out = r(h(ui.Box, { padding: '8', background: 'muted', style: { padding: { t: '37px' }, background: 'brand:surface' } }, 'c'));
    expect(cls(out)).toBe('pt-(--ocms-pt) bg-(--ocms-bg)');
    expect(out).toContain('style="--ocms-pt:37px;--ocms-bg:var(--ocms-color-surface)"');
  });
  it('Card style padding replaces the P token; Stack hidden keeps flex', () => {
    expect(cls(r(h(ui.Card, { padding: '4', style: { padding: { md: { l: '8' } } } }, 'c')))).not.toMatch(/\bp-4\b/);
    expect(cls(r(h(ui.Stack, { direction: 'vertical', style: { hidden: { md: true } } }, 'c')))).toBe('flex-col gap-4 items-stretch flex md:hidden lg:flex');
  });
  it('Columns with tracks fills missing breakpoints and uses the variables', () => {
    const out = r(h(ui.Columns, { count: 2, tracks: { base: ['1fr'], md: ['2fr', '3fr'] } }, 'c'));
    expect(cls(out)).toBe('grid grid-cols-(--ocms-cols) md:grid-cols-(--ocms-cols-md) lg:grid-cols-(--ocms-cols-lg) gap-6');
    expect(out).toContain('--ocms-cols:1fr;--ocms-cols-md:2fr 3fr;--ocms-cols-lg:2fr 3fr');
    expect(r(h(ui.Columns, { count: 2, tracks: ['auto', '1fr', 'auto'] }, 'c'))).toContain('--ocms-cols:auto 1fr auto;--ocms-cols-md:auto 1fr auto;--ocms-cols-lg:auto 1fr auto');
  });
  it('Columns with invalid tracks falls back to count', () => {
    expect(cls(r(h(ui.Columns, { count: 3, tracks: { base: ['1fr;x'] } as any }, 'c')))).toBe('grid grid-cols-1 md:grid-cols-3 gap-6');
  });
  it('Columns alignY and gapX/gapY', () => {
    const out = r(h(ui.Columns, { count: 2, alignY: 'center', gapX: '24px', gapY: '4' }, 'c'));
    expect(cls(out)).toBe('grid grid-cols-1 md:grid-cols-2 gap-6 items-center gap-x-(--ocms-gx) gap-y-(--ocms-gy)');
    expect(out).toContain('--ocms-gx:24px;--ocms-gy:calc(var(--spacing) * 4)');
  });
  it('Stack justify, wrap, responsive direction and align', () => {
    expect(cls(r(h(ui.Stack, { direction: 'horizontal', justify: 'between', wrap: false }, 'c')))).toBe('flex flex-row gap-4 items-stretch justify-between flex-nowrap');
    expect(cls(r(h(ui.Stack, { direction: { base: 'vertical', md: 'horizontal' }, align: { base: 'start', lg: 'center' } }, 'c')))).toBe(
      'flex flex-col md:flex-row md:flex-wrap gap-4 items-start lg:items-center',
    );
  });
  it('Image fit, aspect and height 100%', () => {
    const out = r(h(ui.Image, { src: '/a.png', fit: 'contain', aspect: { base: 'square', md: '3/2', lg: '4/3' } }));
    expect(cls(out)).toBe('w-full object-contain aspect-square md:aspect-[3/2] lg:aspect-[4/3]');
    const full = r(h(ui.Image, { src: '/a.png', style: { height: '100%' } }));
    expect(cls(full)).toBe('w-full object-cover h-(--ocms-h)');
    expect(full).toContain('style="--ocms-h:100%"');
  });
  it('content primitives accept style', () => {
    expect(r(h(ui.Heading, { level: 2, text: 'T', style: { color: 'brand:ink', margin: { b: '4' } } }))).toContain('text-(--ocms-fg)');
    expect(r(h(ui.Price, { value: 5, locale: 'en-US', style: { hidden: { base: true } } }))).toContain('class="hidden md:inline lg:inline"');
    expect(r(h(ui.Button, { label: 'Go', href: '/x', style: { width: '100%' } }))).toContain('w-(--ocms-w)');
    expect(r(h(ui.Divider, { style: { margin: { t: '0' } } }))).toContain('style="--ocms-mt:calc(var(--spacing) * 0)"');
  });
  it('layoutClass accepts the new props and style', () => {
    expect(ui.layoutClass.Columns({ count: 2, tracks: ['1fr', '1fr'] })).toContain('grid-cols-(--ocms-cols)');
    expect(ui.layoutClass.Box({ padding: '8', style: { padding: { t: '2' } } })).toBe('pt-(--ocms-pt)');
    expect(ui.layoutClass.Stack({ direction: 'horizontal', justify: 'end' })).toContain('justify-end');
  });
});

describe('style class tables', () => {
  const src = readFileSync(fileURLToPath(new URL('../../blocks/src/ui/tokens.ts', import.meta.url)), 'utf8');
  const leaves = (o: unknown): string[] => (typeof o === 'string' ? [o] : Object.values(o as object).flatMap(leaves));
  it('every class is a literal Tailwind class string in tokens.ts', () => {
    const all = [STYLE_CLASS, HIDE, SHOW, BORDER_SIDE, STYLE_SINGLE, STACK_DIRECTION, STACK_ALIGN_BP, IMAGE_ASPECT, STACK_JUSTIFY, OBJECT_FIT, FLEX_WRAP].flatMap(leaves);
    expect(all.length).toBeGreaterThan(50);
    for (const v of all) {
      expect(src, v).toContain(`'${v}'`);
      for (const c of v.split(' ')) expect(c, v).toMatch(/^[a-z:-]+(\(.+\)|\[.+\])?$/);
    }
    expect(STYLE_CLASS.pt).toEqual({ base: 'pt-(--ocms-pt)', md: 'md:pt-(--ocms-pt-md)', lg: 'lg:pt-(--ocms-pt-lg)' });
    expect(SHOW.flex).toEqual({ base: 'flex', md: 'md:flex', lg: 'lg:flex' });
  });
});
