/**
 * Eject a composed block to TSX: print a hand-written `defineBlock` file that renders exactly like
 * `defineComposedBlock(spec)` (same fields, same `ui` primitives, same `composedHelpers` value readers and wrappers)
 * and replace the managed `.block.ts` file by it. The Block Builder no longer manages an ejected block.
 *
 * Keep the printed fields in step with `defineComposedBlock` (`@opencloudcms/core/blocks`, composed/define.ts);
 * `test/eject.test.ts` compares both definitions.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { composedKind, overlayDefaultName, validateNodeStyle, type BindSource, type ComposedBlockSpec, type ComposedField, type ComposedNode, type LocalizedText, type ResolvedConfig } from '@opencloudcms/schema';
import { blocksDir, printLiteral, writeComposedBlocks } from './blocks';

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const L = (en: string, vi: string, fr: string, id: string): LocalizedText => ({ 'en-US': en, 'vi-VN': vi, 'fr-FR': fr, 'id-ID': id });

const q = (s: string) => printLiteral(s);
const has = (o: object | undefined, k: string) => !!o && Object.prototype.hasOwnProperty.call(o, k);

/** Same as `layoutValue` of the composed renderer. */
const layoutValue = (l: NonNullable<ComposedBlockSpec['binding']>['layout']) =>
  l?.kind === 'list' ? 'list' : l?.kind === 'carousel' ? `carousel-${l.columns ?? 3}` : `grid-${l?.columns ?? 3}`;

/** Nodes of the elements `els`, in tree order (depth first). */
function nodesOf(n: ComposedNode, els: readonly string[], out: ComposedNode[] = []): ComposedNode[] {
  if (els.includes(n.el)) out.push(n);
  for (const c of n.children ?? []) nodesOf(c, els, out);
  return out;
}
const slotNodes = (n: ComposedNode) => nodesOf(n, ['Slot']);

/** Field name of each `Slot` (`slot`, `slot2`, …), `Region` (`region__<name>`) and `PageContent` (`pageContent`) node. */
function slotNames(tree: ComposedNode): Map<ComposedNode, string> {
  const slots = new Map<ComposedNode, string>();
  slotNodes(tree).forEach((n, i) => slots.set(n, i === 0 ? 'slot' : `slot${i + 1}`));
  for (const n of nodesOf(tree, ['Region', 'PageContent'])) slots.set(n, n.el === 'PageContent' ? 'pageContent' : `region__${String(n.props?.name)}`);
  return slots;
}

/** Same as `regionLabel` of `defineComposedBlock`. */
function regionLabel(p: Record<string, unknown>): unknown {
  if (typeof p.label === 'string' && p.label) return p.label;
  if (p.label && typeof p.label === 'object' && !Array.isArray(p.label)) return p.label;
  return p.name;
}

/** Headings that may name an overlay (depth first, with the `showIf` chain of each), up to the first always-shown one. */
type LabelCandidate = { node: ComposedNode; conds: NonNullable<ComposedNode['showIf']>[] };
function labelCandidates(tree: ComposedNode): LabelCandidate[] {
  const out: LabelCandidate[] = [];
  let done = false;
  const walk = (n: ComposedNode, conds: LabelCandidate['conds']) => {
    if (done) return;
    const c = n.showIf ? [...conds, n.showIf] : conds;
    if (n.el === 'Heading') {
      out.push({ node: n, conds: c });
      if (!c.length) done = true;
      return;
    }
    for (const k of n.children ?? []) walk(k, c);
  };
  walk(tree, []);
  return out;
}

function imageEntryPaths(n: ComposedNode, out = new Set<string>()): Set<string> {
  if (n.el === 'Image') {
    for (const k of ['src', 'alt']) {
      const s = n.bind?.[k];
      if (s?.from === 'entry') out.add(s.path);
    }
  }
  for (const c of n.children ?? []) imageEntryPaths(c, out);
  return out;
}

const call = (fn: string, args: string[]) => `${fn}(${args.join(', ')})`;
const opts = (o: Record<string, unknown>, indent: string) => (Object.keys(o).length ? [printLiteral(o, indent)] : []);

function manualField(f: ComposedField, indent: string): string {
  const o: Record<string, unknown> = {};
  if (f.label !== undefined) o.label = f.label;
  if (f.default !== undefined) o.default = f.default;
  if (f.kind === 'select') o.options = f.options ?? [];
  return call(`b.${f.kind}`, opts(o, indent));
}

/** `fields` entries (`key: b.…(…)`), in the order `defineComposedBlock` produces them. */
function printFields(spec: ComposedBlockSpec, indent: string): string[] {
  const out: [string, string][] = [];
  if (composedKind(spec) === 'overlay') {
    const o = { label: L('Overlay name', 'Tên lớp phủ', 'Nom de la superposition', 'Nama overlay'), default: overlayDefaultName(spec.name) };
    out.push(['name', call('b.text', [printLiteral(o, indent)])]);
  }
  out.push(...Object.entries(spec.fields).map(([k, f]): [string, string] => [k, manualField(f, indent)]));
  const binding = spec.binding;
  if (binding?.mode === 'single') {
    out.push(['entry', call('b.entry', [q(binding.apiId), printLiteral({ label: L('Entry', 'Mục nội dung', 'Entrée', 'Entri') }, indent)])]);
  } else if (binding?.mode === 'collection') {
    const o = binding.options ?? {};
    const limit = binding.limit ?? 12;
    const baseFilter = Object.fromEntries((binding.filter ?? []).map((f) => [f.field, String(f.value)]));
    const defaultSort = binding.sort ? `${binding.sort.field}:${binding.sort.direction}` : undefined;
    const e: Record<string, unknown> = {
      label: L('Entries', 'Danh sách mục', 'Entrées', 'Entri'),
      limit,
      sortable: o.editorSort === true,
      filterable: o.editorFilter === true,
      ...(Object.keys(baseFilter).length ? { baseFilter } : {}),
      ...(defaultSort ? { defaultSort } : {}),
      lockLimit: o.editorLimit !== true,
      default: { mode: 'query', limit, ...(defaultSort ? { sort: defaultSort } : {}) },
    };
    out.push(['entries', call('b.entries', [q(binding.apiId), printLiteral(e, indent)])]);
    if (o.editorLayout) {
      const layout = {
        label: L('Layout', 'Bố cục', 'Disposition', 'Tata letak'),
        options: [
          { value: 'list', label: L('List', 'Danh sách', 'Liste', 'Daftar') },
          ...[2, 3, 4, 5, 6].map((n) => ({ value: `grid-${n}`, label: L(`Grid · ${n}`, `Lưới · ${n}`, `Grille · ${n}`, `Kisi · ${n}`) })),
          ...(binding.layout?.kind === 'carousel'
            ? [1, 2, 3, 4, 5, 6].map((n) => ({ value: `carousel-${n}`, label: L(`Carousel · ${n}`, `Băng chuyền · ${n}`, `Carrousel · ${n}`, `Karosel · ${n}`) }))
            : []),
        ],
        default: layoutValue(binding.layout),
      };
      out.push(['layout', call('b.select', [printLiteral(layout, indent)])]);
    }
  }
  slotNodes(spec.tree).forEach((n, i) => {
    const p = n.props ?? {};
    const o: Record<string, unknown> = {
      label: L('Content', 'Nội dung', 'Contenu', 'Konten'),
      ...(Array.isArray(p.allow) ? { allow: p.allow } : {}),
      ...(typeof p.max === 'number' ? { max: p.max } : {}),
    };
    out.push([i === 0 ? 'slot' : `slot${i + 1}`, call('b.slot', [printLiteral(o, indent)])]);
  });
  for (const n of nodesOf(spec.tree, ['Region', 'PageContent'])) {
    const p = n.props ?? {};
    if (n.el === 'PageContent') {
      out.push(['pageContent', call('b.slot', [printLiteral({ label: L('Page content', 'Nội dung trang', 'Contenu de la page', 'Konten halaman') }, indent)])]);
      continue;
    }
    const o = { label: regionLabel(p), ...(Array.isArray(p.allow) ? { allow: p.allow } : {}) };
    out.push([`region__${String(p.name)}`, call('b.slot', [printLiteral(o, indent)])]);
  }
  return out.map(([k, v]) => `${IDENT.test(k) ? k : q(k)}: ${v},`);
}

// ---- JSX ----

type Out = { jsx: boolean; code: string };
type Val = { lit: unknown } | { expr: string };

interface Gen {
  bound: boolean;
  urlPattern?: string;
  slots: Map<ComposedNode, string>;
  usesLocale: boolean;
  /** The block label is read (clickable image alt, carousel name): `const blockLabel` is printed. */
  usesBlockLabel: boolean;
  /** Counter of the tooltips printed so far (names their `target` and `tip` variables). */
  tooltips: number;
  /** Node → expression that gives it `aria-describedby` (the innermost tooltip whose target it may be). */
  describe: Map<ComposedNode, string>;
  /**
   * Overlay blocks: the headings that may name the dialog (the first one shown wins, as in the renderer). With a single
   * always-shown candidate the ids are static; otherwise a `labelled` index picks one at render time.
   */
  overlay?: { candidates: LabelCandidate[]; dynamic: boolean };
}

const propExpr = (name: string) => (IDENT.test(name) ? `props.${name}` : `props[${q(name)}]`);
const lit = (v: unknown) => (v === undefined ? 'undefined' : printLiteral(v));
const code = (v: Val) => ('expr' in v ? v.expr : lit(v.lit));

function source(g: Gen, s: BindSource): string {
  switch (s.from) {
    case 'entry':
      return g.bound ? `get(entry, ${q(s.path)})` : 'undefined';
    case 'entryUrl':
      return g.bound && g.urlPattern ? `h.entryUrl(${q(g.urlPattern)}, entry, get)` : 'null';
    case 'field':
      return propExpr(s.name);
    case 'const':
      return lit(s.value);
  }
}

/** Bound value if `bind[k]` is set, else the fixed `props[k]` (as the renderer's `val`). */
function val(g: Gen, n: ComposedNode, k: string): Val {
  if (n.bind && has(n.bind, k)) {
    const s = n.bind[k];
    return s.from === 'const' ? { lit: s.value } : { expr: source(g, s) };
  }
  return { lit: n.props?.[k] };
}

/** JSX attribute for a literal value. */
function attrLit(name: string, v: unknown): string {
  if (v === true) return name;
  if (typeof v === 'string' && /^[^"\\\n\r{}<>&]*$/.test(v)) return `${name}="${v}"`;
  return `${name}={${printLiteral(v)}}`;
}
const attrExpr = (name: string, expr: string) => `${name}={${expr}}`;

function textAttr(name: string, v: Val): string {
  if ('expr' in v) return attrExpr(name, `h.text(${v.expr})`);
  const t = typeof v.lit === 'string' ? v.lit : typeof v.lit === 'number' && Number.isFinite(v.lit) ? String(v.lit) : '';
  return attrLit(name, t);
}

/** Literal attributes for token props that are set in `props`. */
function tokens(p: Record<string, unknown>, keys: string[]): string[] {
  return keys.filter((k) => p[k] !== undefined).map((k) => attrLit(k, p[k]));
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * `style={…}` of a node: its `style` as a literal, without the top-level properties that fail validation (the renderer
 * skips invalid values too). Nothing when there is no valid property.
 */
function styleAttr(n: ComposedNode): string[] {
  if (!isObj(n.style)) return [];
  const bad = new Set(validateNodeStyle(n.style, []).map((i) => String(i.path[0])));
  const ok = Object.fromEntries(Object.entries(n.style).filter(([k, v]) => v !== undefined && !bad.has(k)));
  return Object.keys(ok).length ? [attrExpr('style', printLiteral(ok))] : [];
}

/** Non-empty string props (Columns `gapX` / `gapY`), as the renderer's `str`. */
function strings(p: Record<string, unknown>, keys: string[]): string[] {
  return keys.filter((k) => typeof p[k] === 'string' && p[k] !== '').map((k) => attrLit(k, p[k]));
}

/** The text of a bound/fixed value as a JS expression (`h.text(…)` or a string literal). */
function textCode(v: Val): string {
  if ('expr' in v) return `h.text(${v.expr})`;
  return q(typeof v.lit === 'string' ? v.lit : typeof v.lit === 'number' && Number.isFinite(v.lit) ? String(v.lit) : '');
}

/** Boolean props as the renderer's `bool`: nothing when unset. */
const bools = (p: Record<string, unknown>, keys: string[]): string[] => keys.filter((k) => typeof p[k] === 'boolean').map((k) => attrLit(k, p[k]));

/** Expression of the bound `href` of a clickable Image/Box/Card (a fixed `props.href` does not make one clickable). */
const boundHref = (g: Gen, n: ComposedNode): string | null => (n.bind && has(n.bind, 'href') ? `h.href(${source(g, n.bind.href)})` : null);

const describedAttr = (g: Gen, n: ComposedNode): string[] => {
  const d = g.describe.get(n);
  return d ? [attrExpr('describedBy', d)] : [];
};

/** Attributes that make an Image/Box/Card clickable: bound `href`, `action`, `ariaLabel` (Box/Card) and the tooltip link. */
function clickAttrs(g: Gen, n: ComposedNode, aria: boolean): string[] {
  const p = n.props ?? {};
  const href = boundHref(g, n);
  return [...(href ? [attrExpr('href', href)] : []), ...(isObj(p.action) ? [attrLit('action', p.action)] : []), ...(aria ? strings(p, ['ariaLabel']) : []), ...describedAttr(g, n)];
}

function element(tag: string, attrs: string[], children: Out[] | null, indent: string): string {
  const open = `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}`;
  if (!children) return `${open} />`;
  if (!children.length) return `${open}></${tag}>`;
  const inner = indent + '  ';
  const lines = children.map((c) => inner + (c.jsx ? c.code : `{${c.code}}`));
  return `${open}>\n${lines.join('\n')}\n${indent}</${tag}>`;
}

/** `id` attribute from `anchorId`, as the renderer's `str(p.anchorId)`. */
const idAttr = (p: Record<string, unknown>) => (typeof p.anchorId === 'string' && p.anchorId ? [attrLit('id', p.anchorId)] : []);

/** A node that may take the focus a tooltip describes, with the `showIf` chain that must pass for it to render. */
type FocusCandidate = { node: ComposedNode; conds: NonNullable<ComposedNode['showIf']>[]; test: string };

/** JS test of "this node itself is a link or button", or null when it never is (as the renderer's `focusableSelf`). */
function focusTest(g: Gen, n: ComposedNode): string | null {
  const p = n.props ?? {};
  const action = isObj(p.action);
  const href = boundHref(g, n);
  switch (n.el) {
    case 'Button':
      return action ? 'true' : `!!ui.safeHref(h.href(${code(val(g, n, 'href'))}))`;
    case 'Image': {
      const img = `!!h.image(${[code(val(g, n, 'src')), ...(n.bind?.alt || p.alt !== undefined ? [code(val(g, n, 'alt'))] : [])].join(', ')})`;
      return action ? img : href ? `${img} && !!${href}` : null;
    }
    case 'Box':
    case 'Card':
      return action ? 'true' : href ? `!!${href}` : null;
    default:
      return null;
  }
}

/** Focus candidates of the subtree `n` in depth-first order (the first whose test and conditions pass wins). */
function focusCandidates(g: Gen, n: ComposedNode, conds: FocusCandidate['conds'] = [], out: FocusCandidate[] = []): FocusCandidate[] {
  const c = n.showIf ? [...conds, n.showIf] : conds;
  const test = focusTest(g, n);
  if (test) out.push({ node: n, conds: c, test });
  for (const k of n.children ?? []) focusCandidates(g, k, c, out);
  return out;
}

/**
 * Tooltip: the node that takes `aria-describedby` is the first rendered link/button of the child, which depends on the
 * data, so a `target` index is computed at run time (`indexOf(true)` over the candidates, -1: the wrapper takes the focus).
 */
function tooltip(g: Gen, n: ComposedNode, indent: string): Out {
  const p = n.props ?? {};
  const child = n.children?.[0];
  // Same as the renderer: no child, or one hidden by its showIf, renders no tooltip at all.
  if (!child) return { jsx: false, code: 'null' };
  const shown = child.showIf ? condition(g, child.showIf) : undefined;
  const ind = shown ? indent + '  ' : indent;
  const cands = focusCandidates(g, child);
  const id = ++g.tooltips;
  const t = `target${id}`;
  const tip = `tip${id}`;
  cands.forEach((c, i) => g.describe.set(c.node, `${t} === ${i} ? ${tip} : undefined`));
  const inner = ind + (cands.length ? '  ' : '');
  const content: Out = shown ? body(g, child, inner + '    ') : node(g, child, inner + '    ');
  const attrs = [...idAttr(p), textAttr('text', val(g, n, 'text')), ...tokens(p, ['side']), cands.length ? attrExpr('focusWrapper', `${t} < 0`) : 'focusWrapper', ...styleAttr(n)];
  const render = `(${cands.length ? tip : ''}) => ${content.code.includes('\n') ? `(\n${inner}    ${content.code}\n${inner}  )` : content.code}`;
  const el = element('ui.Tooltip', attrs, [{ jsx: false, code: render }], inner);
  const tests = cands.map((c) => [...c.conds.map((x) => condition(g, x)), c.test].join(' && '));
  const out: Out = cands.length ? { jsx: false, code: `((${t}) => (\n${inner}  ${el}\n${inner}))([${tests.join(', ')}].indexOf(true))` } : { jsx: true, code: el };
  if (!shown) return out;
  return { jsx: false, code: `${shown} ? (\n${indent}  ${out.code}\n${indent}) : null` };
}

/** Attributes of a form control from its props, in the renderer's terms. */
function control(g: Gen, n: ComposedNode): string[] {
  const p = n.props ?? {};
  const tx = (keys: string[]) => keys.map((k) => textAttr(k, val(g, n, k)));
  const opt = () => {
    g.usesLocale = true;
    return [attrExpr('options', `h.options(${printLiteral(Array.isArray(p.options) ? p.options : [], '      ')}, locale)`)];
  };
  const name = attrLit('name', typeof p.name === 'string' && p.name ? p.name : '');
  switch (n.el) {
    case 'Input':
      return [name, ...tokens(p, ['type']), ...tx(['label', 'placeholder', 'help']), ...bools(p, ['required', 'disabled']), ...strings(p, ['autocomplete'])];
    case 'Textarea':
      return [name, ...(typeof p.rows === 'number' ? [attrLit('rows', p.rows)] : []), ...tx(['label', 'placeholder', 'help']), ...bools(p, ['required', 'disabled'])];
    case 'Select':
      return [name, ...opt(), ...strings(p, ['defaultValue']), ...tx(['label', 'placeholder', 'help']), ...bools(p, ['required', 'disabled'])];
    case 'Combobox':
      return [name, ...opt(), ...strings(p, ['defaultValue']), ...tx(['label', 'placeholder', 'help']), ...bools(p, ['required', 'disabled']), 'locale={locale}'];
    case 'Radio':
      return [name, ...opt(), ...strings(p, ['defaultValue']), attrLit('orientation', p.orientation === 'horizontal' ? 'horizontal' : 'vertical'), ...tx(['label', 'help']), ...bools(p, ['required', 'disabled'])];
    case 'Checkbox':
      return [name, ...strings(p, ['value']), ...bools(p, ['defaultChecked']), ...tx(['label', 'help']), ...bools(p, ['required', 'disabled'])];
    default:
      return [name, ...bools(p, ['defaultChecked']), ...tx(['label', 'help']), ...bools(p, ['disabled'])];
  }
}

function body(g: Gen, n: ComposedNode, indent: string): Out {
  const p = n.props ?? {};
  const st = [...idAttr(p), ...styleAttr(n)];
  const kids = (): Out[] => (n.children ?? []).map((c) => node(g, c, indent + '  '));
  const jsx = (code: string): Out => ({ jsx: true, code });
  // Same props as the composed renderer (composed/render.tsx), in the same order, then `style`.
  switch (n.el) {
    case 'Box':
      return jsx(element('ui.Box', [...tokens(p, ['padding', 'background']), ...st, ...clickAttrs(g, n, true)], kids(), indent));
    case 'Stack': {
      const direction = isObj(p.direction) ? p.direction : p.direction === 'horizontal' ? 'horizontal' : 'vertical';
      const wrap = typeof p.wrap === 'boolean' ? [attrLit('wrap', p.wrap)] : [];
      return jsx(element('ui.Stack', [attrLit('direction', direction), ...tokens(p, ['gap', 'align', 'justify']), ...wrap, ...st], kids(), indent));
    }
    case 'Columns':
      return jsx(element('ui.Columns', [...tokens(p, ['count', 'gap', 'tracks', 'alignY']), ...strings(p, ['gapX', 'gapY']), ...st], kids(), indent));
    case 'Grid':
      return jsx(element('ui.Grid', [...tokens(p, ['columns', 'gap']), ...st], kids(), indent));
    case 'Card':
      return jsx(element('ui.Card', [...tokens(p, ['padding', 'background']), ...(p.bordered === false ? ['bordered={false}'] : []), ...st, ...clickAttrs(g, n, true)], kids(), indent));
    case 'Slot':
    case 'Region':
    case 'PageContent': {
      const name = g.slots.get(n);
      return { jsx: false, code: name ? `${propExpr(name)} ?? null` : 'null' };
    }
    case 'Overlay': {
      g.usesLocale = true;
      const attrs = [
        'name={overlay}',
        ...tokens(p, ['variant', 'side', 'size']),
        ...(p.closeOnBackdrop === false ? ['closeOnBackdrop={false}'] : []),
        ...(p.showClose === false ? ['showClose={false}'] : []),
        ...overlayLabelledBy(g),
        'locale={locale}',
        ...st,
      ];
      return jsx(element('ui.Overlay', attrs, kids(), indent));
    }
    case 'Heading': {
      const idA = headingId(g, n) ?? idAttr(p);
      const rest = [...tokens(p, ['align']), ...styleAttr(n)];
      return jsx(element('ui.Heading', [...idA, attrLit('level', p.level ?? 2), textAttr('text', val(g, n, 'text')), ...rest], null, indent));
    }
    case 'Text': {
      const html = val(g, n, 'html');
      const htmlAttr = 'expr' in html ? [attrExpr('html', `${html.expr} ?? undefined`)] : html.lit === undefined || html.lit === null ? [] : [attrLit('html', html.lit)];
      return jsx(element('ui.Text', [textAttr('text', val(g, n, 'text')), ...htmlAttr, ...tokens(p, ['size', 'color']), ...st], null, indent));
    }
    case 'Image': {
      const explicitAlt = !!n.bind?.alt || p.alt !== undefined;
      const args = [code(val(g, n, 'src')), ...(explicitAlt ? [code(val(g, n, 'alt'))] : [])];
      // A clickable image is its link's name: a missing alt falls back to the block label.
      const href = boundHref(g, n);
      const clickable = isObj(p.action) ? 'true' : href;
      if (clickable) g.usesBlockLabel = true;
      const alt = clickable ? `alt={${clickable === 'true' ? '' : `${clickable} && `}!img.alt.trim() ? blockLabel : img.alt}` : 'alt={img.alt}';
      const attrs = ['src={img.src}', alt, ...tokens(p, ['ratio']), ...(p.rounded === true ? ['rounded'] : []), ...tokens(p, ['fit', 'aspect']), ...st, ...clickAttrs(g, n, false)];
      const img = element('ui.Image', attrs, null, indent);
      return { jsx: false, code: `h.when(h.image(${args.join(', ')}), (img) => ${img})` };
    }
    case 'Button': {
      const action = isObj(p.action) ? [attrLit('action', p.action)] : [];
      const icon = [...strings(p, ['icon']), ...(p.iconPosition === 'end' ? ['iconPosition="end"'] : []), ...(p.iconOnly === true ? ['iconOnly'] : [])];
      return jsx(element('ui.Button', [textAttr('label', val(g, n, 'label')), attrExpr('href', `h.href(${code(val(g, n, 'href'))})`), ...tokens(p, ['variant', 'size']), ...st, ...action, ...icon, ...describedAttr(g, n)], null, indent));
    }
    case 'Icon':
      return jsx(element('ui.Icon', [...idAttr(p), attrLit('name', typeof p.name === 'string' ? p.name : ''), ...tokens(p, ['size']), textAttr('label', val(g, n, 'label')), ...styleAttr(n)], null, indent));
    case 'Tooltip':
      return tooltip(g, n, indent);
    case 'Accordion':
      return jsx(element('ui.Accordion', [...idAttr(p), ...(p.single === true ? ['single'] : []), ...(p.defaultOpen === 'first' ? ['defaultOpen="first"'] : []), ...styleAttr(n)], kids(), indent));
    case 'AccordionItem':
      return jsx(element('ui.AccordionItem', [...idAttr(p), textAttr('title', val(g, n, 'title'))], kids(), indent));
    case 'Dropdown': {
      g.usesLocale = true;
      const href = boundHref(g, n);
      const attrs = [
        ...idAttr(p),
        textAttr('label', val(g, n, 'label')),
        ...(href ? [attrExpr('href', href)] : []),
        attrLit('openOn', p.openOn === 'click' ? 'click' : 'hover'),
        ...tokens(p, ['placement', 'display', 'triggerVariant']),
        ...(p.chevron === false ? ['chevron={false}'] : []),
        'locale={locale}',
        ...styleAttr(n),
      ];
      return jsx(element('ui.Dropdown', attrs, kids(), indent));
    }
    case 'Tabs': {
      const inner = indent + '  ';
      const panels = (n.children ?? [])
        .filter((c) => c.el === 'TabPanel')
        .map((c) => {
          const content = element('', [], (c.children ?? []).map((k) => node(g, k, inner + '    ')), inner + '    ');
          const fields = [`label: ${textCode(val(g, c, 'label'))}`, ...(typeof c.props?.anchorId === 'string' && c.props.anchorId ? [`id: ${q(c.props.anchorId)}`] : []), `content: ${content}`];
          const o = `{ ${fields.join(', ')} }`;
          return c.showIf ? `...(${condition(g, c.showIf)} ? [${o}] : [])` : o;
        });
      const list = panels.length ? `[\n${panels.map((x) => `${inner}  ${x},`).join('\n')}\n${inner}]` : '[]';
      return jsx(element('ui.Tabs', [...idAttr(p), attrExpr('panels', list), ...tokens(p, ['variant', 'align']), ...styleAttr(n)], null, indent));
    }
    case 'Carousel': {
      g.usesLocale = true;
      g.usesBlockLabel = true;
      const attrs = [
        ...idAttr(p),
        ...tokens(p, ['perView', 'gap']),
        ...(p.arrows === false ? ['arrows={false}'] : []),
        ...(p.dots === false ? ['dots={false}'] : []),
        ...(p.loop === true ? ['loop'] : []),
        ...(typeof p.autoplay === 'number' ? [attrLit('autoplay', p.autoplay)] : []),
        'label={blockLabel}',
        'locale={locale}',
        ...styleAttr(n),
      ];
      return jsx(element('ui.Carousel', attrs, kids(), indent));
    }
    case 'Input':
    case 'Textarea':
    case 'Select':
    case 'Combobox':
    case 'Radio':
    case 'Checkbox':
    case 'Switch':
      return jsx(element(`ui.${n.el}`, [...idAttr(p), ...control(g, n), ...styleAttr(n)], null, indent));
    case 'Badge':
      return jsx(element('ui.Badge', [textAttr('text', val(g, n, 'text')), ...tokens(p, ['variant']), ...st], null, indent));
    case 'Price': {
      g.usesLocale = true;
      const attrs = ['value={m.value}', 'locale={locale}', ...(p.showCurrency === false ? [] : ['currency={m.currency}']), ...st];
      return { jsx: false, code: `h.when(h.money(${code(val(g, n, 'value'))}), (m) => ${element('ui.Price', attrs, null, indent)})` };
    }
    case 'Date': {
      g.usesLocale = true;
      const attrs = [
        attrExpr('value', `h.date(${code(val(g, n, 'value'))})`),
        'locale={locale}',
        attrLit('format', p.format === 'long' ? 'long' : 'short'),
        ...(typeof p.timeZone === 'string' && p.timeZone ? [attrLit('timeZone', p.timeZone)] : []),
        ...st,
      ];
      return jsx(element('ui.DateText', attrs, null, indent));
    }
    case 'Divider':
      return jsx(element('ui.Divider', st, null, indent));
    case 'Spacer':
      return jsx(element('ui.Spacer', [attrLit('size', p.size ?? '8'), ...st], null, indent));
    default:
      return { jsx: false, code: 'null' };
  }
}

/** JS expression of the id a label candidate gets: its own anchorId, else `<overlay name>-title`. */
function labelExpr(c: LabelCandidate): string {
  const a = c.node.props?.anchorId;
  return typeof a === 'string' && a ? q(a) : '`${overlay}-title`';
}

/** `labelledBy` attribute of the overlay (none when the tree has no Heading). */
function overlayLabelledBy(g: Gen): string[] {
  const o = g.overlay;
  if (!o?.candidates.length) return [];
  if (!o.dynamic) {
    const a = o.candidates[0].node.props?.anchorId;
    return [typeof a === 'string' && a ? attrLit('labelledBy', a) : attrExpr('labelledBy', labelExpr(o.candidates[0]))];
  }
  const pick = o.candidates.map((c, i) => `labelled === ${i} ? ${labelExpr(c)} : `).join('');
  return [attrExpr('labelledBy', `${pick}undefined`)];
}

/** `id` attribute of a label candidate heading; undefined for other nodes. */
function headingId(g: Gen, n: ComposedNode): string[] | undefined {
  const o = g.overlay;
  const i = o ? o.candidates.findIndex((c) => c.node === n) : -1;
  if (!o || i < 0) return undefined;
  const a = n.props?.anchorId;
  if (typeof a === 'string' && a) return [attrLit('id', a)];
  return [attrExpr('id', o.dynamic ? `labelled === ${i} ? ${labelExpr(o.candidates[i])} : undefined` : labelExpr(o.candidates[i]))];
}

function condition(g: Gen, c: NonNullable<ComposedNode['showIf']>): string {
  const v = c.from === 'entry' ? (g.bound ? `get(entry, ${q(c.path ?? '')})` : 'undefined') : propExpr(c.name ?? '');
  return `${c.is === 'present' ? '' : '!'}h.present(${v})`;
}

function node(g: Gen, n: ComposedNode, indent: string): Out {
  if (!n.showIf) return body(g, n, indent);
  const inner = body(g, n, indent + '  ');
  const cond = condition(g, n.showIf);
  if (!inner.code.includes('\n')) return { jsx: false, code: `${cond} ? ${inner.code} : null` };
  return { jsx: false, code: `${cond} ? (\n${indent}  ${inner.code}\n${indent}) : null` };
}

/** The `.block.tsx` source of a hand-written `defineBlock` equivalent to `defineComposedBlock(spec)`. */
export function printEjectedBlockTsx(spec: ComposedBlockSpec): string {
  const binding = spec.binding;
  const kind = composedKind(spec);
  const g: Gen = { bound: !!binding, urlPattern: binding?.urlPattern, slots: slotNames(spec.tree), usesLocale: false, usesBlockLabel: false, tooltips: 0, describe: new Map() };
  let labelledLine: string[] = [];
  if (kind === 'overlay') {
    // Same choice as the renderer: the first Heading whose own and ancestors' showIf pass.
    const candidates = labelCandidates(spec.tree);
    const dynamic = candidates.length > 1 || (candidates.length === 1 && candidates[0].conds.length > 0);
    g.overlay = { candidates, dynamic };
    if (dynamic) {
      const all = (c: LabelCandidate) => c.conds.map((x) => condition(g, x)).join(' && ');
      const chain = candidates.map((c, i) => (c.conds.length ? `${all(c)} ? ${i} : ` : `${i}`)).join('');
      labelledLine = [`    const labelled = ${chain}${candidates[candidates.length - 1].conds.length ? '-1' : ''};`];
    }
  }

  const treeIndent = '      ';
  const tree = node(g, spec.tree, treeIndent);
  const treeCode = `(\n${treeIndent}${tree.code}\n    )`;
  let ret: string;
  if (!binding) ret = `return ${treeCode};`;
  else if (binding.mode === 'single') ret = `return h.single(props, { name, label }, (entry) => ${treeCode});`;
  else {
    const o = binding.options ?? {};
    const parts = [
      'name',
      'label',
      `layout: ${q(layoutValue(binding.layout))}`,
      ...(o.editorLayout ? ['editorLayout: true'] : []),
      ...(o.emptyText ? [`emptyText: ${printLiteral(o.emptyText, '      ')}`] : []),
    ];
    const flat = `{ ${parts.join(', ')} }`;
    const cfg = flat.length <= 70 && !flat.includes('\n') ? flat : `{\n${parts.map((x) => `      ${x},`).join('\n')}\n    }`;
    ret = `return h.collection(props, ${cfg}, (entry) => ${treeCode});`;
  }
  const renderLines = [
    ...(g.usesLocale || g.usesBlockLabel ? ['    const locale = h.locale(props);'] : []),
    ...(g.usesBlockLabel ? ['    const blockLabel = h.blockLabel(label, name, locale);'] : []),
    ...(kind === 'overlay' ? [`    const overlay = h.overlayName(props.name, ${q(overlayDefaultName(spec.name))});`] : []),
    ...labelledLine,
    `    ${ret}`,
  ];

  const assetPaths = [...imageEntryPaths(spec.tree)];
  const def = [
    '  name,',
    '  label,',
    `  category: ${q(spec.category)},`,
    ...(spec.icon ? [`  icon: ${q(spec.icon)},`] : []),
    `  version: ${spec.version},`,
    ...(kind !== 'block' ? [`  kind: ${q(kind)},`] : []),
    '  // Reserved props `_locale` (stamped by resolvePage) and `_editor` (editor canvas), as for composed blocks.',
    '  usesLocale: true,',
    ...(assetPaths.length ? [`  entryAssetPaths: ${printLiteral(assetPaths, '  ')},`] : []),
    '  fields: {',
    ...printFields(spec, '    ').map((l) => `    ${l}`),
    '  },',
    '  render: (props) => {',
    ...renderLines,
    '  },',
  ].join('\n');

  const usesGet = /\bget\b/.test(renderLines.join('\n'));
  const imports = [
    ...(/\bb\./.test(def) ? ['b'] : []),
    ...(/\bh\./.test(def) ? ['composedHelpers as h'] : []),
    'defineBlock',
    ...(/\bui\./.test(def) ? ['ui'] : []),
  ];
  return [
    `// Block "${spec.name}", ejected from the OpenCloudCMS Block Builder. Hand-written from now on:`,
    '// the Block Builder no longer manages this file. Register it in src/blocks/index.ts.',
    `import { ${imports.join(', ')} } from '@opencloudcms/core/blocks';`,
    '',
    `const name = ${q(spec.name)};`,
    `const label = ${printLiteral(spec.label)};`,
    ...(usesGet ? ['const get = h.entryReader(name);'] : []),
    '',
    'export default defineBlock({',
    def,
    '});',
    '',
  ].join('\n');
}

/** Thrown when the `.block.tsx` an eject would write already exists (nothing is written). */
export class EjectTargetExistsError extends Error {
  constructor(public readonly file: string) {
    super(`${file} already exists`);
    this.name = 'EjectTargetExistsError';
  }
}

/** `.block.tsx` next to a composed block file. */
export function ejectedBlockFile(file: string): string {
  return file.replace(/\.(ts|js)$/, '.tsx');
}

/**
 * Writes the ejected `.block.tsx` next to the composed block `file`, removes `file` and regenerates `composed.ts`.
 * Returns the written file, the line to add to `src/blocks/index.ts` and every path touched. No rollback: callers
 * wrap it with captureProjectFiles/restoreProjectFiles. Throws EjectTargetExistsError or `writeComposedBlocks` errors.
 */
export async function ejectComposedBlock(
  config: ResolvedConfig,
  spec: ComposedBlockSpec,
  file: string,
): Promise<{ file: string; importLine: string; touched: string[] }> {
  const dir = blocksDir(config);
  const target = ejectedBlockFile(path.resolve(file));
  const rel = path.relative(dir, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`Refusing to write ${target}: outside ${dir}`);
  if (fs.existsSync(target)) throw new EjectTargetExistsError(target);
  fs.writeFileSync(target, printEjectedBlockTsx(spec));
  const touched = await writeComposedBlocks(config, { removeName: spec.name });
  const importPath = `./${rel.split(path.sep).join('/').replace(/\.tsx$/, '')}`;
  return { file: target, importLine: `import ${spec.name} from ${q(importPath)};`, touched: [target, ...touched] };
}
