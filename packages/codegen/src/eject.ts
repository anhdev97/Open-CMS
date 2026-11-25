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
const layoutValue = (l: NonNullable<ComposedBlockSpec['binding']>['layout']) => (l?.kind === 'list' ? 'list' : `grid-${l?.columns ?? 3}`);

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

/** First `Heading` of `n` (depth first), as the composed renderer's `firstHeading`. */
function firstHeading(n: ComposedNode): ComposedNode | undefined {
  if (n.el === 'Heading') return n;
  for (const c of n.children ?? []) {
    const h = firstHeading(c);
    if (h) return h;
  }
  return undefined;
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
  /** Overlay blocks: the heading naming the dialog and its id, as JSX attribute value code (`"x"`, `{…}`). */
  overlay?: { heading?: ComposedNode; labelId?: string };
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

function body(g: Gen, n: ComposedNode, indent: string): Out {
  const p = n.props ?? {};
  const st = [...idAttr(p), ...styleAttr(n)];
  const kids = (): Out[] => (n.children ?? []).map((c) => node(g, c, indent + '  '));
  const jsx = (code: string): Out => ({ jsx: true, code });
  // Same props as the composed renderer (composed/render.tsx), in the same order, then `style`.
  switch (n.el) {
    case 'Box':
      return jsx(element('ui.Box', [...tokens(p, ['padding', 'background']), ...st], kids(), indent));
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
      return jsx(element('ui.Card', [...tokens(p, ['padding', 'background']), ...(p.bordered === false ? ['bordered={false}'] : []), ...st], kids(), indent));
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
        ...(g.overlay?.labelId ? [`labelledBy=${g.overlay.labelId}`] : []),
        'locale={locale}',
        ...st,
      ];
      return jsx(element('ui.Overlay', attrs, kids(), indent));
    }
    case 'Heading': {
      const idA = g.overlay?.heading === n && g.overlay.labelId ? [`id=${g.overlay.labelId}`] : idAttr(p);
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
      const attrs = ['src={img.src}', 'alt={img.alt}', ...tokens(p, ['ratio']), ...(p.rounded === true ? ['rounded'] : []), ...tokens(p, ['fit', 'aspect']), ...st];
      const img = element('ui.Image', attrs, null, indent);
      return { jsx: false, code: `h.when(h.image(${args.join(', ')}), (img) => ${img})` };
    }
    case 'Button': {
      const action = isObj(p.action) ? [attrLit('action', p.action)] : [];
      return jsx(element('ui.Button', [textAttr('label', val(g, n, 'label')), attrExpr('href', `h.href(${code(val(g, n, 'href'))})`), ...tokens(p, ['variant', 'size']), ...action, ...st], null, indent));
    }
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
  const g: Gen = { bound: !!binding, urlPattern: binding?.urlPattern, slots: slotNames(spec.tree), usesLocale: false };
  if (kind === 'overlay') {
    const heading = firstHeading(spec.tree);
    const anchor = heading?.props?.anchorId;
    // Same id as the renderer: the heading's own anchorId, else `<overlay name>-title`.
    const labelId = !heading ? undefined : typeof anchor === 'string' && anchor ? attrLit('id', anchor).slice('id='.length) : '{`${overlay}-title`}';
    g.overlay = { heading, labelId };
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
    ...(g.usesLocale ? ['    const locale = h.locale(props);'] : []),
    ...(kind === 'overlay' ? [`    const overlay = h.overlayName(props.name, ${q(overlayDefaultName(spec.name))});`] : []),
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
