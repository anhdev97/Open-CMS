/**
 * Pure cross-checks between a composed block spec and the project's content types (spec §5.4, §7.3): every entry
 * path, filter, sort and URL placeholder must name a field of `binding.apiId` (or, inside a CollectionList, of the
 * list's type) whose kind fits where it is used.
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
  Image: { src: ['asset', 'url'], alt: [...TEXT, 'asset'], href: ['url'] },
  Button: { label: TEXT, href: ['url'] },
  Badge: { text: TEXT },
  Price: { value: ['number', 'money'] },
  Date: { value: ['date', 'datetime'] },
  // Builder component elements (spec §1 table) and the clickable Image/Box/Card `href`.
  Box: { href: ['url'] },
  Card: { href: ['url'] },
  Dropdown: { label: TEXT, href: ['url'] },
  Tooltip: { text: TEXT },
  AccordionItem: { title: TEXT },
  TabPanel: { label: TEXT },
  Icon: { label: TEXT },
  Input: { label: TEXT, placeholder: TEXT, help: TEXT },
  Textarea: { label: TEXT, placeholder: TEXT, help: TEXT },
  Select: { label: TEXT, placeholder: TEXT, help: TEXT },
  Combobox: { label: TEXT, placeholder: TEXT, help: TEXT },
  Radio: { label: TEXT, help: TEXT },
  Checkbox: { label: TEXT, help: TEXT },
  Switch: { label: TEXT, help: TEXT },
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

type Checker = {
  def: ContentTypeDefinition;
  /**
   * The field, or undefined after reporting why it cannot be used. `firstAsset`: a multiple asset field is fine
   * (Image src/alt show its first asset).
   */
  usable(name: string, path: (string | number)[], firstAsset?: boolean): FieldInfo | undefined;
};

/**
 * Issues (paths relative to the spec) for a spec whose binding or CollectionLists do not fit the content types
 * `types`. Entry paths inside a CollectionList are checked against the list's type, others against the binding's.
 * A CollectionList of an unknown or private type is an issue on its `props.apiId`. A spec without a binding or
 * CollectionList has none. Does not re-run `validateComposedSpec`.
 */
export function checkSpecAgainstTypes(spec: ComposedBlockSpec, types: readonly ContentTypeDefinition[]): ComposedIssue[] {
  const issues: ComposedIssue[] = [];
  const add = (path: (string | number)[], message: string) => issues.push({ path, message });
  const checker = (def: ContentTypeDefinition): Checker => {
    const fields = fieldsOf(def);
    return {
      def,
      usable: (name, path, firstAsset = false) => {
        const fi = fields.get(name);
        if (!fi) return void add(path, `field "${name}" does not exist on "${def.apiId}"`);
        if (fi.listy && !(firstAsset && fi.kind === 'asset')) return void add(path, `field "${name}" is a reference or multiple field and cannot be used`);
        return fi;
      },
    };
  };

  /** Filter, sort and urlPattern of a binding or CollectionList (`at`: the path of the object holding them). */
  const checkQuery = (
    c: Checker,
    q: { filter?: { field: string; value: unknown }[]; sort?: { field: string }; urlPattern?: unknown },
    at: (string | number)[],
  ) => {
    const fields = fieldsOf(c.def);
    (q.filter ?? []).forEach((flt, i) => {
      const path = [...at, 'filter', i];
      const fi = fields.get(flt.field);
      if (!fi || fi.meta) return add([...path, 'field'], `field "${flt.field}" does not exist on "${c.def.apiId}"`);
      if (fi.listy) return add([...path, 'field'], `field "${flt.field}" is a reference or multiple field and cannot be used`);
      if (!fi.indexed) return add([...path, 'field'], `field "${flt.field}" is not indexed; filters need an indexed or unique field`);
      const want = valueKind(fi.kind);
      const ok = want === 'number' ? typeof flt.value === 'number' && Number.isFinite(flt.value) : typeof flt.value === want;
      if (!ok) add([...path, 'value'], `field "${flt.field}" needs a ${want} value`);
    });

    if (q.sort && !META_SORT.includes(q.sort.field)) {
      const fi = fields.get(q.sort.field);
      const path = [...at, 'sort', 'field'];
      if (!fi || fi.meta) add(path, `field "${q.sort.field}" does not exist on "${c.def.apiId}"`);
      else if (fi.listy) add(path, `field "${q.sort.field}" is a reference or multiple field and cannot be used`);
      else if (!fi.indexed) add(path, `field "${q.sort.field}" is not indexed; sort needs an indexed or unique field (or ${META_SORT.join(', ')})`);
    }

    if (typeof q.urlPattern === 'string') {
      for (const m of q.urlPattern.matchAll(PLACEHOLDER)) c.usable(m[1], [...at, 'urlPattern']);
    }
  };

  const b = spec.binding;
  let blockChecker: Checker | null = null;
  if (b) {
    const def = types.find((t) => t.apiId === b.apiId);
    if (!def) return [{ path: ['binding', 'apiId'], message: `unknown content type "${b.apiId}"` }];
    blockChecker = checker(def);
    checkQuery(blockChecker, b, ['binding']);
  }

  /** `c`: the type entry paths of `n` refer to (null: none can be checked). */
  const walk = (n: ComposedNode, path: (string | number)[], c: Checker | null) => {
    let inner = c;
    if (n.el === 'CollectionList') {
      const p = (n.props ?? {}) as { apiId?: unknown; filter?: { field: string; value: unknown }[]; sort?: { field: string }; urlPattern?: unknown };
      const def = types.find((t) => t.apiId === p.apiId);
      inner = null;
      if (!def) add([...path, 'props', 'apiId'], `unknown content type "${String(p.apiId)}"`);
      else if (def.private) add([...path, 'props', 'apiId'], `content type "${def.apiId}" is private and cannot be listed`);
      else {
        inner = checker(def);
        checkQuery(inner, p, [...path, 'props']);
      }
    }
    if (c) {
      for (const [prop, src] of Object.entries(n.bind ?? {})) {
        if (src.from !== 'entry') continue;
        const p = [...path, 'bind', prop, 'path'];
        const fi = c.usable(src.path, p, n.el === 'Image');
        const allowed = ENTRY_PROP_KINDS[n.el]?.[prop];
        if (fi && allowed && !allowed.includes(fi.kind)) {
          add(p, `${n.el}.${prop} cannot show field "${fi.name}" (${fi.kind}); allowed kinds: ${allowed.join(', ')}`);
        }
      }
      if (n.showIf?.from === 'entry' && typeof n.showIf.path === 'string') c.usable(n.showIf.path, [...path, 'showIf', 'path']);
    }
    (n.children ?? []).forEach((ch, i) => walk(ch, [...path, 'children', i], inner));
  };
  walk(spec.tree, ['tree'], blockChecker);
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
