// Pure spec types, validation and versioning for composed (builder-made) page blocks.
// Must not import from `node:*` (bundled for the browser and shared with Nest and the blocks package).
import { ANCHOR_ID_RE, OVERLAY_NAME_RE, validateButtonAction } from './actions';
import { AUTOCOMPLETE_TOKENS, FORM_CONTROL_NAME_RE, INPUT_TYPES, MAX_OPTION_VALUE, optionValues, validateOptions } from './form-controls';
import { validateLocalizedText } from './groups';
import type { LocalizedText } from './i18n';
import { isIconName } from './icons';
import { checkResponsive, isLength, isTrack, MAX_TRACKS, STYLE_SPACING_TOKENS, validateNodeStyle, type NodeStyle } from './style';

export type FormControlElement = 'Input' | 'Textarea' | 'Select' | 'Combobox' | 'Radio' | 'Checkbox' | 'Switch';

export type ComposedElement =
  | 'Box' | 'Stack' | 'Columns' | 'Grid' | 'Card' | 'Slot' | 'Heading' | 'Text'
  | 'Image' | 'Button' | 'Badge' | 'Price' | 'Date' | 'Divider' | 'Spacer' | 'Region' | 'PageContent' | 'Overlay'
  | 'Dropdown' | 'Tooltip' | 'Accordion' | 'AccordionItem' | 'Tabs' | 'TabPanel' | 'Carousel' | 'Icon'
  | 'CollectionList' | FormControlElement;

export const FORM_CONTROL_ELEMENTS: readonly FormControlElement[] = ['Input', 'Textarea', 'Select', 'Combobox', 'Radio', 'Checkbox', 'Switch'];

export const COMPOSED_ELEMENTS: readonly ComposedElement[] = [
  'Box', 'Stack', 'Columns', 'Grid', 'Card', 'Slot', 'Heading', 'Text',
  'Image', 'Button', 'Badge', 'Price', 'Date', 'Divider', 'Spacer', 'Region', 'PageContent', 'Overlay',
  'Dropdown', 'Tooltip', 'Accordion', 'AccordionItem', 'Tabs', 'TabPanel', 'Carousel', 'Icon',
  'CollectionList', ...FORM_CONTROL_ELEMENTS,
];

/** Props of each element that may be bound to data (everything else takes design tokens only). */
export const ELEMENT_BINDABLE: Record<ComposedElement, readonly string[]> = {
  Stack: [], Columns: [], Grid: [], Slot: [], Divider: [], Spacer: [], Region: [], PageContent: [], Overlay: [],
  Accordion: [], Tabs: [], Carousel: [], CollectionList: [],
  Box: ['href'],
  Card: ['href'],
  Heading: ['text'],
  Text: ['text', 'html'],
  Image: ['src', 'alt', 'href'],
  Button: ['label', 'href'],
  Badge: ['text'],
  Price: ['value'],
  Date: ['value'],
  Dropdown: ['label', 'href'],
  Tooltip: ['text'],
  AccordionItem: ['title'],
  TabPanel: ['label'],
  Icon: ['label'],
  Input: ['label', 'placeholder', 'help'],
  Textarea: ['label', 'placeholder', 'help'],
  Select: ['label', 'placeholder', 'help'],
  Combobox: ['label', 'placeholder', 'help'],
  Radio: ['label', 'help'],
  Checkbox: ['label', 'help'],
  Switch: ['label', 'help'],
};

/** Interactive containers: not the root of an overlay frame. */
export const INTERACTIVE_CONTAINERS: readonly ComposedElement[] = ['Dropdown', 'Tooltip', 'Accordion', 'Tabs', 'Carousel'];

/** Elements that render interactive content (not allowed inside a clickable Box/Card, at any depth). */
export const INTERACTIVE_ELEMENTS: readonly ComposedElement[] = ['Button', ...INTERACTIVE_CONTAINERS, 'Slot', ...FORM_CONTROL_ELEMENTS];

/** Elements that become a link or button with a bound `href` or a valid `action`. */
export const CLICKABLE_ELEMENTS: readonly ComposedElement[] = ['Image', 'Box', 'Card'];

/** Max length of a Tooltip `text` bound to a constant. */
export const TOOLTIP_TEXT_MAX = 200;

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
  style?: NodeStyle;
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
  /** `columns`: 2-6 for grid, the desktop per-view count 1-6 for carousel. */
  layout?: { kind: 'grid' | 'list' | 'carousel'; columns?: number };
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

export type ComposedBlockKind = 'block' | 'layout' | 'overlay';

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
// CollectionList keys (`list`, `list2`, … by default) are generated field names too, but only reserved against the
// keys a spec actually has: a clash is reported on the list's `props.key`, never on a manual field (older specs may
// have a manual field named `list`).

/** `key` of a `CollectionList` (its generated block field name). */
export const COLLECTION_LIST_KEY_RE = /^[a-z][a-zA-Z0-9]{0,31}$/;
/** Max `CollectionList`s per block. */
export const MAX_COLLECTION_LISTS = 4;
/** Max `limit` of a `CollectionList`. */
export const COLLECTION_LIST_MAX_LIMIT = 50;
/** Default `limit` of a `CollectionList`. */
export const COLLECTION_LIST_DEFAULT_LIMIT = 12;

/** Props of a `CollectionList` node (its children are the item template). */
export interface CollectionListProps {
  key: string;
  apiId: string;
  filter?: { field: string; value: unknown }[];
  sort?: { field: string; direction: 'asc' | 'desc' };
  /** 1-50, default 12. */
  limit?: number;
  /** `columns`: 2-6 for grid, the desktop per-view count 1-6 for carousel. Default `{ kind: 'grid', columns: 3 }`. */
  layout?: { kind: 'grid' | 'list' | 'carousel'; columns?: number };
  emptyText?: LocalizedText;
  urlPattern?: string;
  /** Options page editors may change. */
  editor?: { filter?: boolean; sort?: boolean; limit?: boolean; layout?: boolean };
}

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
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

const enumLeaf = (allowed: readonly string[], add: (p: (string | number)[], m: string) => void) => (v: unknown, p: (string | number)[]) => {
  if (typeof v !== 'string' || !allowed.includes(v)) add(p, `must be one of ${allowed.join(', ')}`);
};

/** Checks the layout props Columns, Stack and Image accept; other props stay unchecked. */
function checkLayoutProps(
  el: unknown, props: Record<string, unknown>, path: (string | number)[], add: (p: (string | number)[], m: string) => void,
): void {
  const at = (k: string) => [...path, k];
  if (el === 'Columns') {
    if (props.tracks !== undefined) {
      checkResponsive(props.tracks, at('tracks'), (v, p) => {
        if (!Array.isArray(v)) return add(p, 'tracks must be an array');
        if (v.length < 1 || v.length > MAX_TRACKS) add(p, `tracks must have 1 to ${MAX_TRACKS} entries`);
        v.forEach((t, i) => { if (!isTrack(t)) add([...p, i], 'track must be <n>fr (1-12), auto or a length'); });
      });
    }
    if (props.alignY !== undefined) enumLeaf(['start', 'center', 'end', 'stretch'], add)(props.alignY, at('alignY'));
    for (const k of ['gapX', 'gapY']) {
      if (props[k] !== undefined && !isLength(props[k])) add(at(k), 'must be a spacing token or a length like 12px');
    }
  } else if (el === 'Stack') {
    if (props.direction !== undefined) checkResponsive(props.direction, at('direction'), enumLeaf(['vertical', 'horizontal'], add));
    if (props.align !== undefined) checkResponsive(props.align, at('align'), enumLeaf(['start', 'center', 'end', 'stretch'], add));
    if (props.justify !== undefined) enumLeaf(['start', 'center', 'end', 'between'], add)(props.justify, at('justify'));
    if (props.wrap !== undefined && typeof props.wrap !== 'boolean') add(at('wrap'), 'wrap must be a boolean');
  } else if (el === 'Overlay') {
    if (props.variant !== undefined) enumLeaf(['modal', 'drawer'], add)(props.variant, at('variant'));
    if (props.side !== undefined) {
      enumLeaf(['left', 'right', 'top', 'bottom'], add)(props.side, at('side'));
      if (props.variant !== 'drawer') add(at('side'), 'side is only allowed on a drawer');
    }
    if (props.size !== undefined) enumLeaf(['sm', 'md', 'lg', 'xl', 'full'], add)(props.size, at('size'));
    for (const k of ['closeOnBackdrop', 'showClose']) {
      if (props[k] !== undefined && typeof props[k] !== 'boolean') add(at(k), `${k} must be a boolean`);
    }
    if (props.labelledBy !== undefined && props.labelledBy !== 'first-heading') add(at('labelledBy'), "labelledBy must be 'first-heading'");
  } else if (el === 'Image') {
    if (props.fit !== undefined) enumLeaf(['cover', 'contain'], add)(props.fit, at('fit'));
    if (props.aspect !== undefined) checkResponsive(props.aspect, at('aspect'), enumLeaf(['auto', 'square', 'video', '3/2', '4/3', 'wide'], add));
  }
}

type Path = (string | number)[];
type Add = (p: Path, m: string) => void;
type PropCheck = (v: unknown, p: Path, add: Add) => void;

const oneOf = (allowed: readonly string[]): PropCheck => (v, p, add) => enumLeaf(allowed, add)(v, p);
const bool: PropCheck = (v, p, add) => { if (typeof v !== 'boolean') add(p, 'must be a boolean'); };
const intIn = (min: number, max: number): PropCheck => (v, p, add) => {
  if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) add(p, `must be an integer between ${min} and ${max}`);
};
const responsive = (leaf: PropCheck): PropCheck => (v, p, add) => checkResponsive(v, p, (x, q) => leaf(x, q, add));
const controlName: PropCheck = (v, p, add) => {
  if (typeof v !== 'string' || !FORM_CONTROL_NAME_RE.test(v)) add(p, 'name must match ^[A-Za-z][A-Za-z0-9_-]{0,63}$');
};
const iconName: PropCheck = (v, p, add) => { if (!isIconName(v)) add(p, 'must be one of the icon names'); };
const plainText: PropCheck = (v, p, add) => { if (typeof v !== 'string') add(p, 'must be a string'); };
const options: PropCheck = (v, p, add) => { for (const i of validateOptions(v, p)) add(i.path, i.message); };
const autoplay: PropCheck = (v, p, add) => {
  if (v !== 'off' && !(Number.isInteger(v) && (v as number) >= 3 && (v as number) <= 10)) add(p, "autoplay must be 'off' or 3 to 10 seconds");
};
const checkboxValue: PropCheck = (v, p, add) => {
  if (typeof v !== 'string' || !v || v.length > MAX_OPTION_VALUE) add(p, `value must be a non-empty string of at most ${MAX_OPTION_VALUE} characters`);
};

/** Checks a query `filter` (block binding and CollectionList). */
const filterCheck: PropCheck = (v, p, add) => {
  if (!Array.isArray(v)) return add(p, 'filter must be an array');
  v.forEach((f, i) => {
    if (!isObj(f) || typeof f.field !== 'string' || !f.field) add([...p, i, 'field'], 'filter field is required');
    else if (!('value' in f)) add([...p, i, 'value'], 'filter value is required');
    else if (!['string', 'number', 'boolean'].includes(typeof f.value) || (typeof f.value === 'number' && !Number.isFinite(f.value))) {
      add([...p, i, 'value'], 'filter value must be a string, number or boolean');
    }
  });
};
const sortCheck: PropCheck = (v, p, add) => {
  if (!isObj(v) || typeof v.field !== 'string' || !v.field) add([...p, 'field'], 'sort field is required');
  else if (v.field.includes(':')) add([...p, 'field'], 'sort field must not contain ":"');
  else if (v.direction !== 'asc' && v.direction !== 'desc') add([...p, 'direction'], "direction must be 'asc' or 'desc'");
};
const layoutCheck: PropCheck = (v, p, add) => {
  if (!isObj(v) || !['grid', 'list', 'carousel'].includes(v.kind as string)) return add([...p, 'kind'], "layout kind must be 'grid', 'list' or 'carousel'");
  const min = v.kind === 'carousel' ? 1 : 2;
  if (v.columns !== undefined && (!Number.isInteger(v.columns) || (v.columns as number) < min || (v.columns as number) > 6)) {
    add([...p, 'columns'], `columns must be an integer between ${min} and 6`);
  }
};
const urlPatternCheck: PropCheck = (v, p, add) => { if (typeof v !== 'string' || !v) add(p, 'urlPattern must be a non-empty string'); };
const emptyTextCheck: PropCheck = (v, p, add) => {
  if (!isObj(v) || typeof v['en-US'] !== 'string') add([...p, 'en-US'], 'emptyText requires an en-US text');
};
const LIST_EDITOR_KEYS = ['filter', 'sort', 'limit', 'layout'];
const listEditorCheck: PropCheck = (v, p, add) => {
  if (!isObj(v)) return add(p, 'editor must be an object');
  for (const [k, x] of Object.entries(v)) {
    if (!LIST_EDITOR_KEYS.includes(k)) add([...p, k], `editor has no option "${k}"`);
    else if (x !== undefined && typeof x !== 'boolean') add([...p, k], `${k} must be a boolean`);
  }
};
const listKeyCheck: PropCheck = (v, p, add) => {
  if (typeof v !== 'string' || !COLLECTION_LIST_KEY_RE.test(v)) add(p, 'key must match ^[a-z][a-zA-Z0-9]{0,31}$');
};
const apiIdCheck: PropCheck = (v, p, add) => { if (typeof v !== 'string' || !v) add(p, 'apiId is required'); };

/** Same list as `ButtonVariant` in `@opencloudcms/blocks`. */
const BUTTON_VARIANTS = ['default', 'secondary', 'outline', 'ghost', 'link'] as const;
const CONTROL = { name: controlName, required: bool, disabled: bool };
const CHOICE = { ...CONTROL, options, defaultValue: plainText };

/**
 * Props of the new elements (strict: any other prop is an issue, except `anchorId` and `action`, which are checked
 * on every element).
 */
const COMPONENT_PROPS: Partial<Record<ComposedElement, Record<string, PropCheck>>> = {
  Dropdown: {
    openOn: oneOf(['hover', 'click']), placement: oneOf(['bottom-start', 'bottom-end', 'bottom']),
    display: responsive(oneOf(['popover', 'inline'])), triggerVariant: oneOf(BUTTON_VARIANTS), chevron: bool,
  },
  Tooltip: { side: oneOf(['top', 'bottom', 'left', 'right']) },
  Accordion: { single: bool, defaultOpen: oneOf(['none', 'first']) },
  AccordionItem: {},
  Tabs: { variant: oneOf(['underline', 'pills']), align: oneOf(['start', 'center', 'stretch']) },
  TabPanel: {},
  Carousel: {
    perView: responsive(intIn(1, 6)), gap: oneOf(STYLE_SPACING_TOKENS), arrows: bool, dots: bool, loop: bool, autoplay,
  },
  Icon: { name: iconName, size: oneOf(['sm', 'md', 'lg', 'xl']) },
  CollectionList: {
    key: listKeyCheck, apiId: apiIdCheck, filter: filterCheck, sort: sortCheck, limit: intIn(1, COLLECTION_LIST_MAX_LIMIT),
    layout: layoutCheck, emptyText: emptyTextCheck, urlPattern: urlPatternCheck, editor: listEditorCheck,
  },
  Input: { ...CONTROL, type: oneOf(INPUT_TYPES), autocomplete: oneOf(AUTOCOMPLETE_TOKENS) },
  Textarea: { ...CONTROL, rows: intIn(2, 12) },
  Select: CHOICE,
  Combobox: CHOICE,
  Radio: { ...CHOICE, orientation: oneOf(['vertical', 'horizontal']) },
  Checkbox: { ...CONTROL, value: checkboxValue, defaultChecked: bool },
  Switch: { name: controlName, defaultChecked: bool, disabled: bool },
};
const REQUIRED_PROPS: Partial<Record<ComposedElement, readonly string[]>> = {
  Icon: ['name'], CollectionList: ['key', 'apiId'], Input: ['name'], Textarea: ['name'], Select: ['name', 'options'], Combobox: ['name', 'options'],
  Radio: ['name', 'options'], Checkbox: ['name'], Switch: ['name'],
};
/** New props of existing elements (checked when present; other props stay unchecked). */
const EXTRA_PROPS: Partial<Record<ComposedElement, Record<string, PropCheck>>> = {
  Button: { icon: iconName, iconPosition: oneOf(['start', 'end']), iconOnly: bool },
  Box: { ariaLabel: plainText },
  Card: { ariaLabel: plainText },
};
/** Elements that take no children. */
const LEAF_ELEMENTS: readonly ComposedElement[] = ['Icon', ...FORM_CONTROL_ELEMENTS];
const CHILD_COUNTS: Partial<Record<ComposedElement, [number, number, string]>> = {
  Accordion: [1, 30, 'items'], Tabs: [1, 12, 'panels'], Carousel: [1, 20, 'slides'], Tooltip: [1, 1, 'child'],
};
/** Elements whose `action` prop is a `ButtonAction`. */
const ACTION_ELEMENTS: readonly ComposedElement[] = ['Button', ...CLICKABLE_ELEMENTS];

/** Checks the props of the new elements and the new props of Button, Box and Card. */
function checkComponentProps(el: ComposedElement, props: Record<string, unknown>, path: Path, add: Add): void {
  const strict = COMPONENT_PROPS[el];
  const checks = strict ?? EXTRA_PROPS[el];
  if (!checks) return;
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue;
    if (has(checks, k)) checks[k](v, [...path, k], add);
    else if (strict && k !== 'anchorId' && k !== 'action') add([...path, k], `${el} has no prop "${k}"`);
  }
  for (const k of REQUIRED_PROPS[el] ?? []) if (props[k] === undefined) add([...path, k], `${k} is required`);
  if (has(props, 'defaultValue') && typeof props.defaultValue === 'string' && validateOptions(props.options, []).length === 0
    && !optionValues(props.options).includes(props.defaultValue)) {
    add([...path, 'defaultValue'], 'defaultValue must be one of the option values');
  }
}

/** Image, Box or Card with a bound `href` or a valid `action` (renders as a link or button). */
export function isClickable(node: unknown): boolean {
  if (!isObj(node) || !CLICKABLE_ELEMENTS.includes(node.el as ComposedElement)) return false;
  if (isObj(node.bind) && node.bind.href !== undefined) return true;
  return isObj(node.props) && node.props.action !== undefined && validateButtonAction(node.props.action, []).length === 0;
}

const childEl = (c: unknown): unknown => (isObj(c) ? c.el : undefined);
const constText = (s: unknown): string | undefined => (isObj(s) && s.from === 'const' && typeof s.value === 'string' ? s.value : undefined);

/**
 * Where a node sits, for the rules of the new elements. `list`: the enclosing CollectionList (its children are an
 * item template).
 */
type WalkCtx = { parent?: unknown; inDropdown: boolean; inClickable: boolean; list?: { apiId: unknown; urlPattern: unknown } };

export interface ValidateComposedOptions {
  /**
   * apiIds of the content types with a detail page. When given, `entryUrl` without a `urlPattern` is an issue unless
   * the bound type is in the set; when absent (no type context), such an `entryUrl` is accepted.
   */
  detailTypes?: ReadonlySet<string>;
}

/** Key names a CollectionList may not take (besides manual field names and the other lists' keys). */
const RESERVED_LIST_KEY_RE = /^(entry|entries|layout|slot\d*)$/;

export function validateComposedSpec(spec: unknown, opts: ValidateComposedOptions = {}): ComposedIssue[] {
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
      if (b.filter !== undefined) filterCheck(b.filter, ['binding', 'filter'], add);
      if (b.sort !== undefined) sortCheck(b.sort, ['binding', 'sort'], add);
      if (b.limit !== undefined && (!Number.isInteger(b.limit) || (b.limit as number) < 1 || (b.limit as number) > 100)) {
        add(['binding', 'limit'], 'limit must be an integer between 1 and 100');
      }
      if (b.layout !== undefined) layoutCheck(b.layout, ['binding', 'layout'], add);
      if (b.urlPattern !== undefined) urlPatternCheck(b.urlPattern, ['binding', 'urlPattern'], add);
      if (b.options !== undefined) {
        if (!isObj(b.options)) add(['binding', 'options'], 'options must be an object');
        else {
          const o = b.options;
          for (const k of ['editorFilter', 'editorSort', 'editorLimit', 'editorLayout']) {
            if (o[k] === undefined) continue;
            if (typeof o[k] !== 'boolean') add(['binding', 'options', k], `${k} must be a boolean`);
            else if (o[k] && b.mode !== 'collection') add(['binding', 'options', k], `${k} is only allowed in collection mode`);
          }
          if (o.emptyText !== undefined) emptyTextCheck(o.emptyText, ['binding', 'options', 'emptyText'], add);
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

  // layout and overlay blocks
  const rootEl = isObj(spec.tree) ? spec.tree.el : undefined;
  if (rootEl === 'Overlay' && spec.binding !== undefined) add(['binding'], 'an overlay block cannot have a binding');
  if (isObj(spec.fields)) {
    const kind = composedKind(spec as unknown as ComposedBlockSpec);
    if (kind === 'overlay' && has(spec.fields, 'name')) add(['fields', 'name'], '"name" is reserved for the overlay name field');
    if (kind === 'layout' && has(spec.fields, 'pageContent')) add(['fields', 'pageContent'], '"pageContent" is reserved for the page content slot');
  }

  // tree
  const collection = binding?.mode === 'collection';
  const hasBinding = binding !== undefined;
  const hasDetail = (apiId: unknown) => !opts.detailTypes || (typeof apiId === 'string' && opts.detailTypes.has(apiId));
  const checkSource = (s: unknown, path: (string | number)[], ctx: WalkCtx) => {
    if (!isObj(s)) return add(path, 'bind source must be an object');
    switch (s.from) {
      case 'entry':
        if (typeof s.path !== 'string' || !s.path) add([...path, 'path'], 'entry path is required');
        if (!hasBinding && !ctx.list) add(path, "'entry' requires a binding");
        break;
      case 'entryUrl':
        if (ctx.list) {
          if ((typeof ctx.list.urlPattern !== 'string' || !ctx.list.urlPattern) && !hasDetail(ctx.list.apiId)) {
            add(path, "'entryUrl' requires the CollectionList urlPattern or a content type with a detail page");
          }
        } else if (!hasBinding) add(path, "'entryUrl' requires a binding");
        else if ((typeof binding!.urlPattern !== 'string' || !binding!.urlPattern) && !hasDetail(binding!.apiId)) {
          add(path, "'entryUrl' requires binding.urlPattern or a content type with a detail page");
        }
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
  const rootIsOverlay = isObj(spec.tree) && spec.tree.el === 'Overlay';
  const regionNamesSeen = new Set<string>();
  let pageContents = 0;
  let layoutNodes = 0;
  let lists = 0;
  const listKeys = new Set<string>();
  const specKind = isObj(spec.tree) ? composedKind(spec as unknown as ComposedBlockSpec) : 'block';
  const walk = (n: unknown, path: (string | number)[], ctx: WalkCtx) => {
    if (!isObj(n)) return add(path, 'node must be an object');
    const el = n.el as ComposedElement;
    const at = (m: string) => add([...path, 'el'], m);
    let flaggedInClickable = false;
    if (!COMPOSED_ELEMENTS.includes(el)) {
      at(`unknown element "${String(n.el)}"`);
    } else if (el === 'Slot' && (collection || ctx.list)) {
      at('Slot is not allowed inside a collection item template');
    } else if (el === 'Carousel' && (collection || ctx.list)) {
      at('Carousel is not allowed inside a collection item template');
    } else if (el === 'CollectionList' && ctx.list) {
      at('a CollectionList cannot contain a CollectionList');
    } else if (el === 'CollectionList' && collection) {
      at('a CollectionList is not allowed in a block with a collection binding');
    } else if (el === 'CollectionList' && ++lists > MAX_COLLECTION_LISTS) {
      at(`a block can have at most ${MAX_COLLECTION_LISTS} CollectionLists`);
    } else if (el === 'AccordionItem' && ctx.parent !== 'Accordion') {
      at('AccordionItem is only allowed directly inside an Accordion');
    } else if (el === 'TabPanel' && ctx.parent !== 'Tabs') {
      at('TabPanel is only allowed directly inside Tabs');
    } else if (el === 'Dropdown' && ctx.inDropdown) {
      at('a Dropdown cannot contain a Dropdown');
    } else if ((el === 'Region' || el === 'PageContent') && ctx.inDropdown) {
      at(`${el} is not allowed inside a Dropdown`);
    } else if (INTERACTIVE_CONTAINERS.includes(el) && ctx.parent === 'Overlay' && rootIsOverlay && path.length === 3) {
      at(`${el} cannot be the root of an overlay frame (put it inside a Box or Stack)`);
    }
    if (ctx.inClickable && (INTERACTIVE_ELEMENTS.includes(el) || isClickable(n))) {
      flaggedInClickable = true;
      add([...path, 'el'], `${String(el)} is not allowed inside a clickable Box or Card`);
    }
    if ((el === 'Region' || el === 'PageContent') && ctx.list) {
      add([...path, 'el'], `${el} is not allowed inside a collection item template`);
    } else if (el === 'Region' || el === 'PageContent') {
      layoutNodes++;
      if (collection) add([...path, 'el'], `${el} is not allowed in a block with a collection binding`);
      if (rootIsOverlay) add([...path, 'el'], `${el} is not allowed in an overlay block`);
      if (Array.isArray(n.children) ? n.children.length > 0 : n.children !== undefined) add([...path, 'children'], `${el} cannot have children`);
      if (el === 'PageContent' && ++pageContents === 2) add([...path, 'el'], 'only one PageContent is allowed');
      if (el === 'Region' && (n.props === undefined || isObj(n.props))) {
        const rp = isObj(n.props) ? n.props : {};
        if (typeof rp.name !== 'string' || !OVERLAY_NAME_RE.test(rp.name)) add([...path, 'props', 'name'], 'name must match ^[a-z][a-z0-9-]{0,31}$');
        else if (regionNamesSeen.has(rp.name)) add([...path, 'props', 'name'], `duplicate region name "${rp.name}"`);
        else regionNamesSeen.add(rp.name);
        if (rp.label !== undefined && typeof rp.label !== 'string') {
          const m = isObj(rp.label) ? validateLocalizedText(rp.label, 'label') : ['label must be a string or localized text'];
          if (m.length) add([...path, 'props', 'label'], m.join('; '));
        }
        if (rp.allow !== undefined && !(Array.isArray(rp.allow) && rp.allow.every((x) => typeof x === 'string' && x))) {
          add([...path, 'props', 'allow'], 'allow must be an array of block names');
        }
      }
    }
    if (el === 'Overlay' && path.length > 1) add([...path, 'el'], 'Overlay is only allowed as the root node');
    if (n.props !== undefined && !isObj(n.props)) add([...path, 'props'], 'props must be an object');
    else if (el === 'Slot' && isObj(n.props)) {
      const { allow, max } = n.props;
      if (allow !== undefined && !(Array.isArray(allow) && allow.every((x) => typeof x === 'string' && x))) {
        add([...path, 'props', 'allow'], 'allow must be an array of block names');
      }
      if (max !== undefined && !(Number.isInteger(max) && (max as number) > 0)) add([...path, 'props', 'max'], 'max must be a positive integer');
    }
    for (const i of validateNodeStyle(n.style, [...path, 'style'], COMPOSED_ELEMENTS.includes(el) ? el : undefined)) add(i.path, i.message);
    if (isObj(n.props) || (n.props === undefined && REQUIRED_PROPS[el])) {
      checkComponentProps(el, isObj(n.props) ? n.props : {}, [...path, 'props'], add);
    }
    if (isObj(n.props)) {
      checkLayoutProps(el, n.props, [...path, 'props'], add);
      const pp = [...path, 'props'];
      if (n.props.anchorId !== undefined && (typeof n.props.anchorId !== 'string' || !ANCHOR_ID_RE.test(n.props.anchorId))) {
        add([...pp, 'anchorId'], 'anchorId must match ^[A-Za-z][\\w-]{0,63}$');
      }
      if (n.props.action !== undefined) {
        if (ACTION_ELEMENTS.includes(el)) for (const i of validateButtonAction(n.props.action, [...pp, 'action'])) add(i.path, i.message);
        else add([...pp, 'action'], 'action is only allowed on Button, Image, Box and Card');
      }
      if (el === 'CollectionList' && typeof n.props.key === 'string' && COLLECTION_LIST_KEY_RE.test(n.props.key)) {
        const key = n.props.key;
        const kp = [...pp, 'key'];
        if (listKeys.has(key)) add(kp, `duplicate CollectionList key "${key}"`);
        else if (fieldNames.has(key)) add(kp, `key collides with field "${key}"`);
        else if (RESERVED_LIST_KEY_RE.test(key) || RESERVED_BLOCK_PROPS.includes(key) || key in Object.prototype
          || (specKind === 'overlay' && key === 'name') || (specKind === 'layout' && key === 'pageContent')) {
          add(kp, `"${key}" is reserved`);
        }
        listKeys.add(key);
      }
      if (el === 'Dropdown' && n.props.chevron === false && isObj(n.bind) && n.bind.href !== undefined) {
        add([...pp, 'chevron'], 'a Dropdown with a link must keep its chevron (it opens the panel)');
      }
    }
    if (isObj(n.bind)) {
      if (el === 'Image' && isClickable(n) && constText(n.bind.alt)?.trim() === '') {
        add([...path, 'bind', 'alt'], 'a clickable image needs a non-empty alt (it names the link)');
      }
      const tip = el === 'Tooltip' ? constText(n.bind.text) : undefined;
      if (tip !== undefined && tip.length > TOOLTIP_TEXT_MAX) add([...path, 'bind', 'text'], `text must be at most ${TOOLTIP_TEXT_MAX} characters`);
    }
    if (n.bind !== undefined) {
      if (!isObj(n.bind)) add([...path, 'bind'], 'bind must be an object');
      else for (const [k, s] of Object.entries(n.bind)) {
        if (COMPOSED_ELEMENTS.includes(el) && !ELEMENT_BINDABLE[el].includes(k)) {
          add([...path, 'bind', k], `${String(el)} has no bindable prop "${k}"`);
        }
        checkSource(s, [...path, 'bind', k], ctx);
      }
    }
    if (n.showIf !== undefined) {
      const s = n.showIf;
      const sp = [...path, 'showIf'];
      if (!isObj(s)) add(sp, 'showIf must be an object');
      else {
        if (s.is !== 'present' && s.is !== 'absent') add([...sp, 'is'], "is must be 'present' or 'absent'");
        if (s.from === 'entry') {
          if (!hasBinding && !ctx.list) add(sp, "'entry' requires a binding");
          if (typeof s.path !== 'string' || !s.path) add([...sp, 'path'], 'path is required');
        } else if (s.from === 'field') {
          if (typeof s.name !== 'string' || !fieldNames.has(s.name)) add([...sp, 'name'], `unknown field "${String(s.name)}"`);
        } else add([...sp, 'from'], "from must be 'entry' or 'field'");
      }
    }
    const kids = Array.isArray(n.children) ? n.children : [];
    if (LEAF_ELEMENTS.includes(el) && kids.length > 0) add([...path, 'children'], `${el} cannot have children`);
    const count = CHILD_COUNTS[el];
    if (count && (n.children === undefined || Array.isArray(n.children)) && (kids.length < count[0] || kids.length > count[1])) {
      add([...path, 'children'], count[0] === count[1] ? `${el} must have exactly ${count[0]} ${count[2]}` : `${el} must have ${count[0]} to ${count[1]} ${count[2]}`);
    }
    kids.forEach((c, i) => {
      const ce = childEl(c);
      const cp = [...path, 'children', i, 'el'];
      // A misplaced AccordionItem/TabPanel is reported by its own rule.
      if (ce === 'AccordionItem' || ce === 'TabPanel') return;
      if (el === 'Accordion') add(cp, 'an Accordion accepts only AccordionItem children');
      else if (el === 'Tabs') add(cp, 'Tabs accept only TabPanel children');
      else if (el === 'Tooltip' && (ce === 'Tooltip' || ce === 'Dropdown' || FORM_CONTROL_ELEMENTS.includes(ce as FormControlElement))) {
        add(cp, `a Tooltip cannot wrap a ${String(ce)}`);
      }
    });
    if (n.children !== undefined) {
      if (!Array.isArray(n.children)) add([...path, 'children'], 'children must be an array');
      else {
        const next: WalkCtx = {
          parent: el,
          inDropdown: ctx.inDropdown || el === 'Dropdown',
          inClickable: (ctx.inClickable && !flaggedInClickable) || ((el === 'Box' || el === 'Card') && isClickable(n)),
          list: el === 'CollectionList' ? { apiId: isObj(n.props) ? n.props.apiId : undefined, urlPattern: isObj(n.props) ? n.props.urlPattern : undefined } : ctx.list,
        };
        n.children.forEach((c, i) => walk(c, [...path, 'children', i], next));
      }
    }
  };
  if (spec.tree === undefined) add(['tree'], 'tree is required');
  else walk(spec.tree, ['tree'], { inDropdown: false, inClickable: false });
  if (layoutNodes > 0 && pageContents === 0 && !rootIsOverlay && !collection) add(['tree'], 'a layout block requires exactly one PageContent');

  return issues;
}

export function composedManifestEntry(spec: ComposedBlockSpec): { name: string; version: number; richText?: string[]; kind?: ComposedBlockKind } {
  const richText = Object.entries(spec.fields ?? {}).filter(([, f]) => f.kind === 'richText').map(([n]) => n);
  const kind = composedKind(spec);
  return {
    name: spec.name,
    version: spec.version,
    ...(richText.length ? { richText } : {}),
    ...(kind !== 'block' ? { kind } : {}),
  };
}

/** `ProductCard` → `product-card` (block folders and file names, default overlay names). */
export function kebabName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

/** Default `name` of an overlay block placement: the block name in kebab case, cut to the overlay name length. */
export function overlayDefaultName(blockName: string): string {
  return kebabName(blockName).slice(0, 32).replace(/-+$/, '');
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

const someNode = (n: unknown, f: (n: ComposedNode) => boolean): boolean => {
  if (!isObj(n)) return false;
  return f(n as unknown as ComposedNode) || (Array.isArray(n.children) && n.children.some((c) => someNode(c, f)));
};

/** `overlay` when the tree root is an `Overlay`, `layout` when it holds a `Region` or `PageContent`, else `block`. */
export function composedKind(spec: Pick<ComposedBlockSpec, 'tree'> | undefined): ComposedBlockKind {
  const tree = spec?.tree as unknown;
  if (isObj(tree) && tree.el === 'Overlay') return 'overlay';
  return someNode(tree, (n) => n.el === 'Region' || n.el === 'PageContent') ? 'layout' : 'block';
}

/** Names of the valid, first-seen `Region`s of `spec`, in tree order. */
export function regionNames(spec: Pick<ComposedBlockSpec, 'tree'> | undefined): string[] {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (!isObj(n)) return;
    const name = isObj(n.props) ? n.props.name : undefined;
    if (n.el === 'Region' && typeof name === 'string' && OVERLAY_NAME_RE.test(name) && !out.includes(name)) out.push(name);
    if (Array.isArray(n.children)) n.children.forEach(walk);
  };
  walk(spec?.tree);
  return out;
}

/**
 * The `CollectionList`s of `spec` with a valid, first-seen `key`, in tree order (each one's key is its generated
 * `b.entries` block field).
 */
export function collectionListsOf(spec: Pick<ComposedBlockSpec, 'tree'> | undefined): { key: string; node: ComposedNode }[] {
  const out: { key: string; node: ComposedNode }[] = [];
  const walk = (n: unknown) => {
    if (!isObj(n)) return;
    const key = isObj(n.props) ? n.props.key : undefined;
    if (n.el === 'CollectionList' && typeof key === 'string' && COLLECTION_LIST_KEY_RE.test(key) && !out.some((l) => l.key === key)) {
      out.push({ key, node: n as unknown as ComposedNode });
    }
    if (Array.isArray(n.children)) n.children.forEach(walk);
  };
  walk(spec?.tree);
  return out;
}

export function isBreakingChange(prev: ComposedBlockSpec, next: ComposedBlockSpec): boolean {
  if (slotsChanged(prev, next)) return true;
  // Stored list content lives in a field named after the key: a removed key or another type drops it.
  const nextLists = collectionListsOf(next);
  for (const l of collectionListsOf(prev)) {
    const n = nextLists.find((x) => x.key === l.key);
    if (!n || n.node.props?.apiId !== l.node.props?.apiId) return true;
  }
  if (composedKind(prev) !== composedKind(next)) return true;
  if (regionNames(prev).join('\n') !== regionNames(next).join('\n')) return true;
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
