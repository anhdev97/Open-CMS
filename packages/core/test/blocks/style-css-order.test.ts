// The style system's `--ocms-*` classes must win over every token class of the same element that sets the same CSS
// property. Tailwind v4 emits same-property utilities sorted by name (`(` sorts first), so an `x-(--ocms-*)` rule that
// meets a token class for the same property loses unless the element leaves the token class out. This test renders
// every primitive with every style property, compiles the element's classes with the repo's Tailwind and the admin
// theme, and checks that no token class rule for the same property (in the same media context) comes after the
// `--ocms` rule.
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'tailwindcss';
import { beforeAll, describe, expect, it } from 'vitest';
import { ui } from '../../blocks/src';

const here = dirname(fileURLToPath(import.meta.url));
const req = createRequire(resolve(here, '../../package.json'));
const THEME = resolve(here, '../../admin/src/styles/theme.css');

type Compiler = Awaited<ReturnType<typeof compile>>;
let tw: Compiler;

beforeAll(async () => {
  tw = await compile(`@import "tailwindcss";\n@import "${THEME}";`, {
    base: here,
    loadStylesheet: async (id: string, base: string) => {
      // Bare CSS packages (tw-animate-css) only export a `style` condition: resolve their package.json `main`.
      const pkg = (name: string) => {
        const dir = resolve(here, '../../node_modules', name);
        return resolve(dir, JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8')).main);
      };
      const path = id === 'tailwindcss' ? req.resolve('tailwindcss/index.css') : id.startsWith('/') || id.startsWith('.') ? resolve(base, id) : pkg(id);
      return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
    },
  });
});

type Decl = { cls: string; ctx: string; prop: string; i: number };

const unescape = (s: string) => s.replace(/\\(.)/g, '$1');

/** Flat list of `(class, media context, property)` in output order; rules with states/pseudos are left out. */
function declarations(css: string, only: string[]): Decl[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Decl[] = [];
  const stack: string[] = [];
  let buf = '';
  let i = 0;
  for (const ch of src) {
    if (ch === '{') { stack.push(buf.trim()); buf = ''; continue; }
    if (ch === ';' || ch === '}') {
      const decl = buf.trim();
      buf = '';
      const sel = [...stack].reverse().find((s) => s.startsWith('.'));
      if (decl && sel && /^[a-z-]+\s*:/.test(decl) && !stack.some((s) => s.startsWith('@layer properties') || s.startsWith('@property') || s.startsWith('@supports'))) {
        const m = /^\.((?:\\.|[^\s:.,>[])+)$/.exec(sel);
        if (m && only.includes(unescape(m[1]))) {
          const ctx = stack.filter((s) => s.startsWith('@media')).join(' ');
          out.push({ cls: unescape(m[1]), ctx, prop: decl.slice(0, decl.indexOf(':')).trim(), i: i++ });
        }
      }
      if (ch === '}') stack.pop();
      continue;
    }
    buf += ch;
  }
  return out;
}

const SIDES = ['top', 'right', 'bottom', 'left'];
/** Longhands a property sets, so a shorthand and a longhand of the same box count as the same property. */
function longhands(prop: string): string[] {
  const box = /^(padding|margin)(?:-(block|inline))?$/.exec(prop);
  if (box) return (box[2] === 'block' ? ['top', 'bottom'] : box[2] === 'inline' ? ['left', 'right'] : SIDES).map((s) => `${box[1]}-${s}`);
  const border = /^border-(width|color|style)$/.exec(prop);
  if (border) return SIDES.map((s) => `border-${s}-${border[1]}`);
  if (prop === 'gap') return ['column-gap', 'row-gap'];
  return [prop];
}

/** `[--ocms class, token class, property]` of every token class rule that wins over an `--ocms` rule. */
function losers(className: string): string[] {
  const classes = className.split(/\s+/).filter(Boolean);
  const decls = declarations(tw.build(classes), classes);
  const bad: string[] = [];
  for (const o of decls.filter((d) => d.cls.includes('--ocms'))) {
    const lo = longhands(o.prop);
    for (const t of decls) {
      if (t.cls.includes('--ocms') || t.ctx !== o.ctx || t.i < o.i) continue;
      if (longhands(t.prop).some((p) => lo.includes(p))) bad.push(`${t.cls} beats ${o.cls} (${o.prop})`);
    }
  }
  return [...new Set(bad)];
}

/** Display classes (one per breakpoint, `hidden` included) must not compete with a base display class. */
function displayLosers(className: string): string[] {
  const classes = className.split(/\s+/).filter(Boolean);
  if (!classes.some((c) => /^(md:|lg:)?hidden$/.test(c))) return [];
  const decls = declarations(tw.build(classes), classes).filter((d) => d.prop === 'display');
  const bad: string[] = [];
  for (const hd of decls.filter((d) => d.cls.endsWith('hidden'))) {
    for (const t of decls) if (t !== hd && t.ctx === hd.ctx && t.i > hd.i) bad.push(`${t.cls} beats ${hd.cls}`);
  }
  return bad;
}

const rootClass = (html: string) => /class="([^"]*)"/.exec(html)?.[1] ?? '';

const STYLES: Record<string, Record<string, unknown>> = {
  paddingTop: { padding: { t: '4' } },
  paddingAll: { padding: { t: '4', r: '4', b: '4', l: '4' } },
  paddingMd: { padding: { md: { l: '12' } } },
  margin: { margin: { t: '4', r: '4', b: '4', l: '4' } },
  marginMd: { margin: { md: { t: '2' } } },
  width: { width: '50%' },
  widthLg: { width: { lg: '320px' } },
  maxWidth: { maxWidth: '640px' },
  height: { height: '12' },
  heightMd: { height: { md: '100%' } },
  minHeight: { minHeight: '320px' },
  background: { background: 'brand:ink' },
  color: { color: 'brand:ink' },
  border: { borderWidth: '2', borderColor: '#112233' },
  borderSide: { borderWidth: '2', borderSides: ['b'] },
  radius: { radius: 'none' },
  hiddenBase: { hidden: { base: true } },
  hiddenMd: { hidden: { md: true } },
  hiddenLg: { hidden: { base: true, lg: true } },
  span: { span: 2 },
};

type Case = [string, (style: Record<string, unknown>) => ReturnType<typeof h>];
const BUTTON_VARIANTS = ['default', 'secondary', 'outline', 'ghost', 'link'] as const;
const BUTTON_SIZES = ['sm', 'default', 'lg'] as const;
const BADGE_VARIANTS = ['default', 'secondary', 'outline', 'destructive'] as const;

const CASES: Case[] = [
  ['Box', (style) => h(ui.Box, { style } as any, 'x')],
  ['Box padding+background', (style) => h(ui.Box, { padding: '12', background: 'muted', style } as any, 'x')],
  ['Stack vertical', (style) => h(ui.Stack, { direction: 'vertical', style } as any, 'x')],
  ['Stack horizontal', (style) => h(ui.Stack, { direction: 'horizontal', justify: 'between', align: 'center', style } as any, 'x')],
  ['Columns', (style) => h(ui.Columns, { count: 3, gap: '8', style } as any, 'x')],
  ['Columns tracks', (style) => h(ui.Columns, { count: 2, tracks: ['1fr', 'auto'], gapX: '4', gapY: '24px', alignY: 'center', style } as any, 'x')],
  ['Grid', (style) => h(ui.Grid, { columns: 4, style } as any, 'x')],
  ['Card', (style) => h(ui.Card, { style } as any, 'x')],
  ['Card padding+background', (style) => h(ui.Card, { padding: '8', background: 'primary', style } as any, 'x')],
  ['Card unbordered', (style) => h(ui.Card, { bordered: false, style } as any, 'x')],
  ...([1, 2, 3, 4] as const).map((level): Case => [`Heading ${level}`, (style) => h(ui.Heading, { level, text: 't', align: 'center', style } as any)]),
  ['Text', (style) => h(ui.Text, { text: 't', size: 'lg', style } as any)],
  ['Text color', (style) => h(ui.Text, { text: 't', color: 'muted', style } as any)],
  ['Image', (style) => h(ui.Image, { src: '/a.png', style } as any)],
  ['Image ratio rounded', (style) => h(ui.Image, { src: '/a.png', ratio: 'video', rounded: true, fit: 'contain', style } as any)],
  ['Image aspect', (style) => h(ui.Image, { src: '/a.png', aspect: { base: 'square', md: 'wide' }, style } as any)],
  ...BUTTON_VARIANTS.flatMap((variant) =>
    BUTTON_SIZES.map((size): Case => [`Button ${variant} ${size}`, (style) => h(ui.Button, { label: 'b', href: '/x', variant, size, style } as any)]),
  ),
  ...BADGE_VARIANTS.map((variant): Case => [`Badge ${variant}`, (style) => h(ui.Badge, { text: 'b', variant, style } as any)]),
  ['Price', (style) => h(ui.Price, { value: 3, locale: 'en', style } as any)],
  ['DateText', (style) => h(ui.DateText, { value: '2026-01-01', locale: 'en', format: 'short', style } as any)],
  ['Divider', (style) => h(ui.Divider, { style } as any)],
  ['Spacer', (style) => h(ui.Spacer, { size: '12', style } as any)],
];

describe('style classes win over token classes in the compiled CSS', () => {
  it('the parser sees the token and the --ocms rules of a known pair', () => {
    const d = declarations(tw.build(['h-9', 'h-(--ocms-h)']), ['h-9', 'h-(--ocms-h)']);
    expect(d.map((x) => x.cls)).toEqual(['h-(--ocms-h)', 'h-9']);
    expect(losers('h-9 h-(--ocms-h)')).toEqual(['h-9 beats h-(--ocms-h) (height)']);
  });

  for (const [name, make] of CASES) {
    for (const [prop, style] of Object.entries(STYLES)) {
      it(`${name} × ${prop}`, () => {
        const cls = rootClass(renderToString(make(style)));
        expect([...losers(cls), ...displayLosers(cls)]).toEqual([]);
      });
    }
    it(`${name} × all at once`, () => {
      const all = Object.assign({}, ...Object.values(STYLES).filter((s) => !('hidden' in s)));
      const cls = rootClass(renderToString(make(all)));
      expect(losers(cls)).toEqual([]);
    });
  }

  it('Stack wrap:false keeps flex-nowrap the only flex-wrap class at every breakpoint', () => {
    for (const direction of ['horizontal', { base: 'vertical', md: 'horizontal' }, { md: 'horizontal', lg: 'vertical' }]) {
      const cls = rootClass(renderToString(h(ui.Stack, { direction, wrap: false } as any, 'x'))).split(' ');
      expect(cls.filter((c) => /flex-wrap$/.test(c))).toEqual([]);
    }
  });
});

describe('Columns tracks match the legacy grid-cols classes', () => {
  const expand = (v: string) => v.replace(/repeat\((\d+),\s*([^)]*\))\)/g, (_, n, t) => Array(Number(n)).fill(t.replace(/\s+/g, '')).join(' '));
  const ruleValue = (cls: string) => /grid-template-columns:\s*([^;]+);/.exec(tw.build([cls]).split(`.${cls.replace(/:/g, '\\:')}`)[1] ?? '')?.[1];
  it('the migrated count:3 tracks give the same columns as grid-cols-1 md:grid-cols-3', async () => {
    const { migrateLegacyProps } = await import('../../admin/src/block-builder/style/migrate');
    const { tracks } = migrateLegacyProps('Columns', { count: 3 }, undefined).props as { tracks: unknown };
    const out = renderToString(h(ui.Columns, { count: 3, tracks } as any, 'x'));
    const vars = Object.fromEntries([...out.matchAll(/(--ocms-cols(?:-md|-lg)?):([^;"]+)/g)].map((m) => [m[1], m[2]]));
    expect(vars['--ocms-cols']).toBe(expand(ruleValue('grid-cols-1')!));
    expect(vars['--ocms-cols-md']).toBe(expand(ruleValue('md:grid-cols-3')!));
    expect(vars['--ocms-cols-lg']).toBe(expand(ruleValue('md:grid-cols-3')!));
  });
});
