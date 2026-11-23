// Pure spec types, validation and versioning for composed (builder-made) page blocks.
// Must not import from `node:*` (bundled for the browser and shared with Nest and the blocks package).
import { validateLocalizedText } from './groups';
import type { LocalizedText } from './i18n';

export type ComposedElement =
  | 'Box' | 'Stack' | 'Columns' | 'Grid' | 'Card' | 'Slot' | 'Heading' | 'Text'
  | 'Image' | 'Button' | 'Badge' | 'Price' | 'Date' | 'Divider' | 'Spacer';

export const COMPOSED_ELEMENTS: readonly ComposedElement[] = [
  'Box', 'Stack', 'Columns', 'Grid', 'Card', 'Slot', 'Heading', 'Text',
  'Image', 'Button', 'Badge', 'Price', 'Date', 'Divider', 'Spacer',
];

/** Props of each element that may be bound to data (everything else takes design tokens only). */
export const ELEMENT_BINDABLE: Record<ComposedElement, readonly string[]> = {
  Box: [], Stack: [], Columns: [], Grid: [], Card: [], Slot: [], Divider: [], Spacer: [],
  Heading: ['text'],
  Text: ['text', 'html'],
  Image: ['src', 'alt'],
  Button: ['label', 'href'],
  Badge: ['text'],
  Price: ['value'],
  Date: ['value'],
};

export const COMPOSED_FIELD_KINDS = ['text', 'longText', 'richText', 'number', 'boolean', 'select', 'image', 'link'] as const;
export type ComposedFieldKind = (typeof COMPOSED_FIELD_KINDS)[number];

export type BindSource =
  | { from: 'entry'; path: string }
  | { from: 'entryUrl' }
  | { from: 'field'; name: string }
  | { from: 'const'; value: unknown };

export interface ComposedNode {
  el: ComposedElement;
  props?: Record<string, unknown>;
  bind?: Record<string, BindSource>;
  showIf?: { from: 'entry' | 'field'; path?: string; name?: string; is: 'present' | 'absent' };
  children?: ComposedNode[];
}

export interface ComposedField {
  kind: ComposedFieldKind;
  label?: LocalizedText | string;
  default?: unknown;
  /** Required for `select`, not allowed on other kinds. */
  options?: (string | number)[];
}

export interface ComposedBinding {
  apiId: string;
  mode: 'single' | 'collection';
  filter?: { field: string; value: unknown }[];
  sort?: { field: string; direction: 'asc' | 'desc' };
  limit?: number;
  layout?: { kind: 'grid' | 'list'; columns?: number };
  urlPattern?: string;
  options?: {
    editorFilter?: boolean;
    editorSort?: boolean;
    editorLimit?: boolean;
    editorLayout?: boolean;
    emptyText?: LocalizedText;
  };
}

export interface ComposedBlockSpec {
  id: string;
  name: string;
  label: LocalizedText;
  category: string;
  icon?: string;
  version: number;
  binding?: ComposedBinding;
  fields: Record<string, ComposedField>;
  tree: ComposedNode;
}

export type ComposedIssue = { path: (string | number)[]; message: string };

const ID_RE = /^blk_[a-z0-9]{6,}$/;
/** Block field names `defineBlocks` accepts. */
export const BLOCK_FIELD_KEY_RE = /^[A-Za-z][A-Za-z0-9]*$/;
/** Prop names used by core or Puck on every block item (`defineBlocks` rejects them as field names). */
export const RESERVED_BLOCK_PROPS: readonly string[] = ['id', '_v', 'puck', 'editMode'];
/** Reserved props stamped on composed (and `usesLocale`) block items. */
export const COMPOSED_RESERVED_PROPS: readonly string[] = ['_locale', '_editor'];
/**
 * Field names `defineComposedBlock` may generate (`entry`, `entries`, `layout`, `slot`, `slot2`, …). Manual fields
 * never use them, whatever the binding and tree, so a later binding or Slot cannot clash with stored content.
 */
export const COMPOSED_GENERATED_FIELD_RE = /^(entry|entries|layout|slot\d*)$/;

/** Why `name` cannot be a manual field of a composed block (null when it can). */
export function composedFieldNameIssue(name: string): string | null {
  if (!BLOCK_FIELD_KEY_RE.test(name)) return 'field name must start with a letter and use letters and digits only';
  if (RESERVED_BLOCK_PROPS.includes(name) || COMPOSED_RESERVED_PROPS.includes(name)) return `"${name}" is reserved`;
  if (COMPOSED_GENERATED_FIELD_RE.test(name)) return `"${name}" is reserved for a generated field`;
  if (name in Object.prototype) return `"${name}" is reserved`;
  return null;
}

const DEFAULT_CHECKS: Record<ComposedFieldKind, ((d: unknown) => boolean) | null> = {
  text: (d) => typeof d === 'string',
  longText: (d) => typeof d === 'string',
  richText: (d) => typeof d === 'string',
  number: (d) => typeof d === 'number' && Number.isFinite(d),
  boolean: (d) => typeof d === 'boolean',
  select: null, // checked against the options
  image: (d) => d === null || (!!d && typeof d === 'object' && !Array.isArray(d)),
  link: (d) => d === null || (!!d && typeof d === 'object' && !Array.isArray(d)),
};
const DEFAULT_EXPECTED: Record<ComposedFieldKind, string> = {
  text: 'a string', longText: 'a string', richText: 'a string', number: 'a number', boolean: 'a boolean',
  select: 'one of the options', image: 'an object or null', link: 'an object or null',
};
const NAME_RE = /^[A-Z][A-Za-z0-9]{0,63}$/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function validateComposedSpec(spec: unknown): ComposedIssue[] {
  const issues: ComposedIssue[] = [];
  const add = (path: (string | number)[], message: string) => issues.push({ path, message });
  if (!isObj(spec)) return [{ path: [], message: 'Spec must be an object' }];

  if (typeof spec.id !== 'string' || !ID_RE.test(spec.id)) add(['id'], 'id must match ^blk_[a-z0-9]{6,}$');
  if (typeof spec.name !== 'string' || !NAME_RE.test(spec.name)) add(['name'], 'name must be PascalCase (^[A-Z][A-Za-z0-9]{0,63}$)');
  if (!isObj(spec.label) || typeof spec.label['en-US'] !== 'string' || !spec.label['en-US'].trim()) {
    add(['label', 'en-US'], 'label requires a non-empty en-US text');
  } else for (const m of validateLocalizedText(spec.label, 'label')) add(['label'], m);
  if (typeof spec.category !== 'string' || !spec.category.trim()) add(['category'], 'category is required');
  if (spec.icon !== undefined && typeof spec.icon !== 'string') add(['icon'], 'icon must be a string');
  if (!Number.isInteger(spec.version) || (spec.version as number) < 1) add(['version'], 'version must be an integer >= 1');

  // binding
  let binding: Record<string, unknown> | undefined;
  if (spec.binding !== undefined) {
    if (!isObj(spec.binding)) add(['binding'], 'binding must be an object');
    else {
      binding = spec.binding;
      const b = binding;
      if (typeof b.apiId !== 'string' || !b.apiId) add(['binding', 'apiId'], 'apiId is required');
      if (b.mode !== 'single' && b.mode !== 'collection') add(['binding', 'mode'], "mode must be 'single' or 'collection'");
      if (b.mode === 'single') {
        for (const k of ['filter', 'sort', 'limit', 'layout']) if (b[k] !== undefined) add(['binding', k], `${k} is only allowed in collection mode`);
      }
      if (b.filter !== undefined) {
        if (!Array.isArray(b.filter)) add(['binding', 'filter'], 'filter must be an array');
        else b.filter.forEach((f, i) => {
          if (!isObj(f) || typeof f.field !== 'string' || !f.field) add(['binding', 'filter', i, 'field'], 'filter field is required');
          else if (!('value' in f)) add(['binding', 'filter', i, 'value'], 'filter value is required');
          else if (!['string', 'number', 'boolean'].includes(typeof f.value) || (typeof f.value === 'number' && !Number.isFinite(f.value))) {
            add(['binding', 'filter', i, 'value'], 'filter value must be a string, number or boolean');
          }
        });
      }
      if (b.sort !== undefined) {
        if (!isObj(b.sort) || typeof b.sort.field !== 'string' || !b.sort.field) add(['binding', 'sort', 'field'], 'sort field is required');
        else if (b.sort.field.includes(':')) add(['binding', 'sort', 'field'], 'sort field must not contain ":"');
        else if (b.sort.direction !== 'asc' && b.sort.direction !== 'desc') add(['binding', 'sort', 'direction'], "direction must be 'asc' or 'desc'");
      }
      if (b.limit !== undefined && (!Number.isInteger(b.limit) || (b.limit as number) < 1 || (b.limit as number) > 100)) {
        add(['binding', 'limit'], 'limit must be an integer between 1 and 100');
      }
      if (b.layout !== undefined) {
        if (!isObj(b.layout) || (b.layout.kind !== 'grid' && b.layout.kind !== 'list')) add(['binding', 'layout', 'kind'], "layout kind must be 'grid' or 'list'");
        else if (b.layout.columns !== undefined && (!Number.isInteger(b.layout.columns) || (b.layout.columns as number) < 2 || (b.layout.columns as number) > 6)) {
          add(['binding', 'layout', 'columns'], 'columns must be an integer between 2 and 6');
        }
      }
      if (b.urlPattern !== undefined && (typeof b.urlPattern !== 'string' || !b.urlPattern)) add(['binding', 'urlPattern'], 'urlPattern must be a non-empty string');
      if (b.options !== undefined) {
        if (!isObj(b.options)) add(['binding', 'options'], 'options must be an object');
        else {
          const o = b.options;
          for (const k of ['editorFilter', 'editorSort', 'editorLimit', 'editorLayout']) {
            if (o[k] === undefined) continue;
            if (typeof o[k] !== 'boolean') add(['binding', 'options', k], `${k} must be a boolean`);
            else if (o[k] && b.mode !== 'collection') add(['binding', 'options', k], `${k} is only allowed in collection mode`);
          }
          if (o.emptyText !== undefined && (!isObj(o.emptyText) || typeof o.emptyText['en-US'] !== 'string')) {
            add(['binding', 'options', 'emptyText', 'en-US'], 'emptyText requires an en-US text');
          }
        }
      }
    }
  }

  // fields
  const fieldNames = new Set<string>();
  if (!isObj(spec.fields)) add(['fields'], 'fields must be an object');
  else {
    for (const [name, f] of Object.entries(spec.fields)) {
      fieldNames.add(name);
      const nameIssue = composedFieldNameIssue(name);
      if (nameIssue) add(['fields', name], nameIssue);
      if (!isObj(f) || !(COMPOSED_FIELD_KINDS as readonly string[]).includes(f.kind as string)) {
        add(['fields', name, 'kind'], `kind must be one of ${COMPOSED_FIELD_KINDS.join(', ')}`);
        continue;
      }
      if (f.label !== undefined && typeof f.label !== 'string') {
        const m = validateLocalizedText(f.label, 'label');
        if (m.length) add(['fields', name, 'label'], m.join('; '));
      }
      const kind = f.kind as ComposedFieldKind;
      const check = DEFAULT_CHECKS[kind];
      if (check && f.default !== undefined && !check(f.default)) add(['fields', name, 'default'], `default must be ${DEFAULT_EXPECTED[kind]}`);
      if (f.kind === 'select') {
        const o = f.options;
        const ok = Array.isArray(o) && o.length > 0 && o.every((x) => typeof x === 'string' || typeof x === 'number') && new Set(o).size === o.length;
        if (!ok) add(['fields', name, 'options'], 'select requires a non-empty array of unique strings or numbers');
        else if (f.default !== undefined && !o.includes(f.default as string | number)) add(['fields', name, 'default'], 'default must be one of the options');
      } else if (f.options !== undefined) {
        add(['fields', name, 'options'], 'options are only allowed on select fields');
      }
    }
  }

  // tree
  const collection = binding?.mode === 'collection';
  const hasBinding = binding !== undefined;
  const checkSource = (s: unknown, path: (string | number)[]) => {
    if (!isObj(s)) return add(path, 'bind source must be an object');
    switch (s.from) {
      case 'entry':
        if (typeof s.path !== 'string' || !s.path) add([...path, 'path'], 'entry path is required');
        if (!hasBinding) add(path, "'entry' requires a binding");
        break;
      case 'entryUrl':
        if (!hasBinding) add(path, "'entryUrl' requires a binding");
        else if (typeof binding!.urlPattern !== 'string' || !binding!.urlPattern) add(path, "'entryUrl' requires binding.urlPattern");
        break;
      case 'field':
        if (typeof s.name !== 'string' || !fieldNames.has(s.name)) add([...path, 'name'], `unknown field "${String(s.name)}"`);
        break;
      case 'const':
        if (!('value' in s)) add([...path, 'value'], 'const value is required');
        break;
      default:
        add([...path, 'from'], "from must be 'entry', 'entryUrl', 'field' or 'const'");
    }
  };
  const walk = (n: unknown, path: (string | number)[]) => {
    if (!isObj(n)) return add(path, 'node must be an object');
    const el = n.el as ComposedElement;
    if (!COMPOSED_ELEMENTS.includes(el)) {
      add([...path, 'el'], `unknown element "${String(n.el)}"`);
    } else if (el === 'Slot' && collection) {
      add([...path, 'el'], 'Slot is not allowed inside a collection item template');
    }
    if (n.props !== undefined && !isObj(n.props)) add([...path, 'props'], 'props must be an object');
    else if (el === 'Slot' && isObj(n.props)) {
      const { allow, max } = n.props;
      if (allow !== undefined && !(Array.isArray(allow) && allow.every((x) => typeof x === 'string' && x))) {
        add([...path, 'props', 'allow'], 'allow must be an array of block names');
      }
      if (max !== undefined && !(Number.isInteger(max) && (max as number) > 0)) add([...path, 'props', 'max'], 'max must be a positive integer');
    }
    if (n.bind !== undefined) {
      if (!isObj(n.bind)) add([...path, 'bind'], 'bind must be an object');
      else for (const [k, s] of Object.entries(n.bind)) {
        if (COMPOSED_ELEMENTS.includes(el) && !ELEMENT_BINDABLE[el].includes(k)) {
          add([...path, 'bind', k], `${String(el)} has no bindable prop "${k}"`);
        }
        checkSource(s, [...path, 'bind', k]);
      }
    }
    if (n.showIf !== undefined) {
      const s = n.showIf;
      const sp = [...path, 'showIf'];
      if (!isObj(s)) add(sp, 'showIf must be an object');
      else {
        if (s.is !== 'present' && s.is !== 'absent') add([...sp, 'is'], "is must be 'present' or 'absent'");
        if (s.from === 'entry') {
          if (!hasBinding) add(sp, "'entry' requires a binding");
          if (typeof s.path !== 'string' || !s.path) add([...sp, 'path'], 'path is required');
        } else if (s.from === 'field') {
          if (typeof s.name !== 'string' || !fieldNames.has(s.name)) add([...sp, 'name'], `unknown field "${String(s.name)}"`);
        } else add([...sp, 'from'], "from must be 'entry' or 'field'");
      }
    }
    if (n.children !== undefined) {
      if (!Array.isArray(n.children)) add([...path, 'children'], 'children must be an array');
      else n.children.forEach((c, i) => walk(c, [...path, 'children', i]));
    }
  };
  if (spec.tree === undefined) add(['tree'], 'tree is required');
  else walk(spec.tree, ['tree']);

  return issues;
}

export function composedManifestEntry(spec: ComposedBlockSpec): { name: string; version: number; richText?: string[] } {
  const richText = Object.entries(spec.fields ?? {}).filter(([, f]) => f.kind === 'richText').map(([n]) => n);
  return richText.length ? { name: spec.name, version: spec.version, richText } : { name: spec.name, version: spec.version };
}

/**
 * Identity of each `Slot` of `tree`, in tree order (the order `defineComposedBlock` names them `slot`, `slot2`, …):
 * its position path (child indices) and its sorted `allow` list (`*` = any block).
 */
export function slotSignature(tree: ComposedNode | undefined): string[] {
  const out: string[] = [];
  const walk = (n: ComposedNode | undefined, path: number[]) => {
    if (!n || typeof n !== 'object') return;
    if (n.el === 'Slot') {
      const allow = Array.isArray(n.props?.allow) ? [...(n.props!.allow as unknown[])].map(String).sort().join(',') : '*';
      out.push(`${path.join('.')}|${allow}`);
    }
    (Array.isArray(n.children) ? n.children : []).forEach((c, i) => walk(c, [...path, i]));
  };
  walk(tree, []);
  return out;
}

/**
 * True when stored content of a slot would land in another slot or be dropped: fewer slots, or any existing slot
 * moved or given another `allow`. A slot added after the existing ones is not breaking.
 */
export function slotsChanged(prev: ComposedBlockSpec, next: ComposedBlockSpec): boolean {
  const a = slotSignature(prev.tree);
  const b = slotSignature(next.tree);
  return b.length < a.length || a.some((s, i) => b[i] !== s);
}

export function isBreakingChange(prev: ComposedBlockSpec, next: ComposedBlockSpec): boolean {
  if (slotsChanged(prev, next)) return true;
  for (const [name, f] of Object.entries(prev.fields ?? {})) {
    const n = next.fields?.[name];
    if (!n || n.kind !== f.kind) return true;
    if (f.kind === 'select' && (f.options ?? []).some((o) => !(n.options ?? []).includes(o))) return true;
  }
  const a = prev.binding;
  const b = next.binding;
  if (!a !== !b) return true;
  if (a && b && (a.apiId !== b.apiId || a.mode !== b.mode)) return true;
  return false;
}

export function withAutoVersion(prev: ComposedBlockSpec | null, next: ComposedBlockSpec): ComposedBlockSpec {
  if (!prev) return { ...next, version: 1 };
  return { ...next, version: isBreakingChange(prev, next) ? prev.version + 1 : prev.version };
}
