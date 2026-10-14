import type {
  ContentTypeDefinition,
  ContentTypeInput,
  FieldDefinition,
  FieldFlags,
  FieldKind,
  FieldOptionsMap,
  FieldSpec,
  OpenCmsConfig,
} from './types';

type BuilderArg<K extends FieldKind> = FieldFlags & { id: string } & FieldOptionsMap[K];

const FLAG_KEYS = ['id', 'required', 'localizable', 'indexed', 'unique', 'label', 'description'] as const;

function builder<K extends FieldKind>(kind: K) {
  return (arg: BuilderArg<K>): FieldSpec<K> => {
    const options: Record<string, unknown> = {};
    const flags: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(arg)) {
      if (value === undefined) continue;
      if ((FLAG_KEYS as readonly string[]).includes(key)) flags[key] = value;
      else options[key] = value;
    }
    return { ...(flags as unknown as FieldFlags & { id: string }), kind, options: options as FieldOptionsMap[K] };
  };
}

/** Field builders used in `*.schema.ts` files. */
export const f = {
  text: builder('text'),
  longText: builder('longText'),
  richText: builder('richText'),
  slug: builder('slug'),
  email: builder('email'),
  url: builder('url'),
  number: builder('number'),
  boolean: builder('boolean'),
  date: builder('date'),
  datetime: builder('datetime'),
  json: builder('json'),
  money: builder('money'),
  asset: builder('asset'),
  reference: builder('reference'),
  taxonomy: builder('taxonomy'),
};

export function normalizeField(name: string, spec: FieldSpec): FieldDefinition {
  const field: FieldDefinition = {
    id: spec.id,
    name,
    kind: spec.kind,
    required: !!spec.required,
    localizable: !!spec.localizable,
    indexed: !!spec.indexed || !!spec.unique,
    unique: !!spec.unique,
    options: { ...(spec.options ?? {}) } as FieldDefinition['options'],
  };
  if (spec.label) field.label = spec.label;
  if (spec.description) field.description = spec.description;
  return field;
}

/** Declares a content type. The returned object is already normalized. */
export function defineContentType(input: ContentTypeInput): ContentTypeDefinition {
  const def: ContentTypeDefinition = {
    id: input.id,
    apiId: input.apiId,
    displayName: input.displayName,
    fields: Object.entries(input.fields).map(([name, spec]) => normalizeField(name, spec)),
  };
  if (input.description) def.description = input.description;
  return def;
}

/** Normalizes a definition that came over the wire (e.g. from the admin UI). */
export function normalizeDefinition(raw: ContentTypeDefinition): ContentTypeDefinition {
  const def: ContentTypeDefinition = {
    id: raw.id,
    apiId: raw.apiId,
    displayName: raw.displayName,
    fields: (raw.fields ?? []).map((fld) =>
      normalizeField(fld.name, { ...fld, options: { ...(fld.options ?? {}) } } as FieldSpec),
    ),
  };
  if (raw.description) def.description = raw.description;
  return def;
}

export function defineConfig(config: OpenCmsConfig): OpenCmsConfig {
  return config;
}

/** Generates short random ids like `fld_k3j9x2` for new types / fields. */
export function newId(prefix: 'ct' | 'fld'): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 8; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${prefix}_${out}`;
}
