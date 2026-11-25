/**
 * Pure cross-checks between a composed block spec and the project's content types (spec §5.4, §7.3): every entry
 * path, filter, sort and URL placeholder must name a field of `binding.apiId` whose kind fits where it is used.
 */
import type { ComposedBlockSpec, ComposedElement, ComposedIssue, ComposedNode, ContentTypeDefinition, FieldKind } from '@opencloudcms/schema';

type Kind = FieldKind;
type FieldInfo = { name: string; kind: Kind; indexed: boolean; listy: boolean; meta: boolean };

const TEXT: readonly Kind[] = ['text', 'longText', 'slug', 'email'];

/** Field kinds each bindable element prop accepts from an entry (spec §5.4). */
export const ENTRY_PROP_KINDS: Partial<Record<ComposedElement, Record<string, readonly Kind[]>>> = {
  Heading: { text: TEXT },
  Text: { text: TEXT, html: ['richText'] },
  // `alt` may also read the asset's own alt text (resolved by resolvePage). A multiple asset field shows its first asset.
  Image: { src: ['asset', 'url'], alt: [...TEXT, 'asset'] },
  Button: { label: TEXT, href: ['url'] },
  Badge: { text: TEXT },
  Price: { value: ['number', 'money'] },
  Date: { value: ['date', 'datetime'] },
};

/** Entry properties every content API item carries besides its fields. */
const META_FIELDS: Record<string, Kind> = { documentId: 'text', createdAt: 'datetime', updatedAt: 'datetime', publishedAt: 'datetime' };
const META_SORT = ['createdAt', 'updatedAt', 'publishedAt'];

const PLACEHOLDER = /\{([^{}]+)\}/g;

function fieldsOf(def: ContentTypeDefinition): Map<string, FieldInfo> {
  const out = new Map<string, FieldInfo>();
  for (const [name, kind] of Object.entries(META_FIELDS)) out.set(name, { name, kind, indexed: false, listy: false, meta: true });
  for (const f of def.fields) {
    const multiple = !!(f.options as { multiple?: boolean } | undefined)?.multiple;
    out.set(f.name, {
      name: f.name,
      kind: f.kind,
      indexed: f.indexed || f.unique,
      listy: multiple || f.kind === 'reference' || f.kind === 'taxonomy',
      meta: false,
    });
  }
  return out;
}

function valueKind(kind: Kind): 'boolean' | 'number' | 'string' {
  if (kind === 'boolean') return 'boolean';
  if (kind === 'number' || kind === 'money') return 'number';
  return 'string';
}

/**
 * Issues (paths relative to the spec) for a spec whose binding does not fit the content types `types`. A spec
 * without a binding has none. Does not re-run `validateComposedSpec`.
 */
export function checkSpecAgainstTypes(spec: ComposedBlockSpec, types: readonly ContentTypeDefinition[]): ComposedIssue[] {
  const b = spec.binding;
  if (!b) return [];
  const issues: ComposedIssue[] = [];
  const add = (path: (string | number)[], message: string) => issues.push({ path, message });
  const def = types.find((t) => t.apiId === b.apiId);
  if (!def) return [{ path: ['binding', 'apiId'], message: `unknown content type "${b.apiId}"` }];
  const fields = fieldsOf(def);

  /**
   * The field, or undefined after reporting why it cannot be used. `firstAsset`: a multiple asset field is fine
   * (Image src/alt show its first asset).
   */
  const usable = (name: string, path: (string | number)[], firstAsset = false): FieldInfo | undefined => {
    const fi = fields.get(name);
    if (!fi) return void add(path, `field "${name}" does not exist on "${def.apiId}"`);
    if (fi.listy && !(firstAsset && fi.kind === 'asset')) return void add(path, `field "${name}" is a reference or multiple field and cannot be used`);
    return fi;
  };

  (b.filter ?? []).forEach((flt, i) => {
    const path = ['binding', 'filter', i];
    const fi = fields.get(flt.field);
    if (!fi || fi.meta) return add([...path, 'field'], `field "${flt.field}" does not exist on "${def.apiId}"`);
    if (fi.listy) return add([...path, 'field'], `field "${flt.field}" is a reference or multiple field and cannot be used`);
    if (!fi.indexed) return add([...path, 'field'], `field "${flt.field}" is not indexed; filters need an indexed or unique field`);
    const want = valueKind(fi.kind);
    const ok = want === 'number' ? typeof flt.value === 'number' && Number.isFinite(flt.value) : typeof flt.value === want;
    if (!ok) add([...path, 'value'], `field "${flt.field}" needs a ${want} value`);
  });

  if (b.sort && !META_SORT.includes(b.sort.field)) {
    const fi = fields.get(b.sort.field);
    const path = ['binding', 'sort', 'field'];
    if (!fi || fi.meta) add(path, `field "${b.sort.field}" does not exist on "${def.apiId}"`);
    else if (fi.listy) add(path, `field "${b.sort.field}" is a reference or multiple field and cannot be used`);
    else if (!fi.indexed) add(path, `field "${b.sort.field}" is not indexed; sort needs an indexed or unique field (or ${META_SORT.join(', ')})`);
  }

  if (typeof b.urlPattern === 'string') {
    for (const m of b.urlPattern.matchAll(PLACEHOLDER)) usable(m[1], ['binding', 'urlPattern']);
  }

  const walk = (n: ComposedNode, path: (string | number)[]) => {
    for (const [prop, src] of Object.entries(n.bind ?? {})) {
      if (src.from !== 'entry') continue;
      const p = [...path, 'bind', prop, 'path'];
      const fi = usable(src.path, p, n.el === 'Image');
      const allowed = ENTRY_PROP_KINDS[n.el]?.[prop];
      if (fi && allowed && !allowed.includes(fi.kind)) {
        add(p, `${n.el}.${prop} cannot show field "${fi.name}" (${fi.kind}); allowed kinds: ${allowed.join(', ')}`);
      }
    }
    if (n.showIf?.from === 'entry' && typeof n.showIf.path === 'string') usable(n.showIf.path, [...path, 'showIf', 'path']);
    (n.children ?? []).forEach((c, i) => walk(c, [...path, 'children', i]));
  };
  walk(spec.tree, ['tree']);
  return issues;
}

/** `path: message` lines of an issue list. */
export function formatIssues(issues: readonly ComposedIssue[]): string[] {
  return issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
}

/** Block name -> problems against `types` (an empty list when the block fits). */
export function composedBlockProblems(specs: readonly ComposedBlockSpec[], types: readonly ContentTypeDefinition[]): Record<string, string[]> {
  return Object.fromEntries(specs.map((s) => [s.name, formatIssues(checkSpecAgainstTypes(s, types))]));
}
