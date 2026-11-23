import type {
  BlockField,
  BooleanBlockField,
  ColorBlockField,
  EntriesBlockField,
  EntryBlockField,
  ImageBlockField,
  Label,
  LinkBlockField,
  ListBlockField,
  LongTextBlockField,
  NumberBlockField,
  OptionValue,
  RadioBlockField,
  RichTextBlockField,
  SelectBlockField,
  SelectOption,
  SlotBlockField,
  SpacingBlockField,
  TextBlockField,
} from './types';

type Opts<F> = Omit<F, 'kind'>;

/** Field builders for `defineBlock({ fields })`. */
export const b = {
  text: (o: Opts<TextBlockField> = {}): TextBlockField => ({ ...o, kind: 'text' }),
  longText: (o: Opts<LongTextBlockField> = {}): LongTextBlockField => ({ ...o, kind: 'longText' }),
  richText: (o: Opts<RichTextBlockField> = {}): RichTextBlockField => ({ ...o, kind: 'richText' }),
  number: (o: Opts<NumberBlockField> = {}): NumberBlockField => ({ ...o, kind: 'number' }),
  boolean: (o: Opts<BooleanBlockField> = {}): BooleanBlockField => ({ ...o, kind: 'boolean' }),
  select: <const T extends OptionValue>(o: {
    options: readonly SelectOption<T>[];
    default?: NoInfer<T>;
    label?: Label;
  }): SelectBlockField<T> => ({ ...o, kind: 'select' }),
  radio: <const T extends OptionValue>(o: {
    options: readonly SelectOption<T>[];
    default?: NoInfer<T>;
    label?: Label;
  }): RadioBlockField<T> => ({ ...o, kind: 'radio' }),
  link: (o: Opts<LinkBlockField> = {}): LinkBlockField => ({ ...o, kind: 'link' }),
  image: (o: Opts<ImageBlockField> = {}): ImageBlockField => ({ ...o, kind: 'image' }),
  color: (o: Opts<ColorBlockField> = {}): ColorBlockField => ({ ...o, kind: 'color' }),
  spacing: (o: Opts<SpacingBlockField> = {}): SpacingBlockField => ({ ...o, kind: 'spacing' }),
  entry: (apiId: string, o: Omit<Opts<EntryBlockField>, 'apiId'> = {}): EntryBlockField => ({ ...o, kind: 'entry', apiId }),
  entries: (apiId: string, o: Omit<Opts<EntriesBlockField>, 'apiId'> = {}): EntriesBlockField => ({
    ...o,
    kind: 'entries',
    apiId,
  }),
  list: <const S extends Record<string, BlockField>>(
    fields: S,
    o: Omit<Opts<ListBlockField<S>>, 'fields'> = {},
  ): ListBlockField<S> => ({ ...o, kind: 'list', fields }),
  slot: (o: Opts<SlotBlockField> = {}): SlotBlockField => ({ ...o, kind: 'slot' }),
};

export const optionValue = <T extends OptionValue>(o: SelectOption<T>): T =>
  typeof o === 'object' && o !== null ? o.value : o;

/** Value a field starts with when its block is inserted (`undefined` = no default prop). */
export function fieldDefault(f: BlockField): unknown {
  switch (f.kind) {
    case 'text':
    case 'longText':
    case 'richText':
      return f.default ?? '';
    case 'boolean':
      return f.default ?? false;
    case 'select':
    case 'radio':
      return f.default ?? (f.options.length ? optionValue(f.options[0]) : undefined);
    case 'number':
    case 'color':
    case 'spacing':
      return f.default;
    case 'link':
    case 'image':
      return f.default ?? null;
    case 'entry':
      return null;
    case 'entries':
      return { mode: 'pick', ids: [] };
    case 'list':
      return f.default ?? [];
    case 'slot':
      return [];
  }
}

export function fieldsDefaults(fields: Record<string, BlockField>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, f] of Object.entries(fields)) {
    const v = fieldDefault(f);
    if (v !== undefined) out[k] = v;
  }
  return out;
}
