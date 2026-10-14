import { z, type ZodTypeAny } from 'zod';
import { isMultiRelation } from './physical';
import type { ContentTypeDefinition, FieldDefinition } from './types';

const uuid = () => z.string().uuid();

/** Zod schema for the value of one field (not considering required-ness). */
export function fieldValueSchema(field: FieldDefinition): ZodTypeAny {
  const o = field.options as Record<string, any>;
  switch (field.kind) {
    case 'text':
      return z.string().max(o.maxLength ?? 255);
    case 'slug':
      return z
        .string()
        .max(o.maxLength ?? 255)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lowercase slug like "my-product"');
    case 'email':
      return z.string().email().max(320);
    case 'url':
      return z.string().url().max(2048);
    case 'longText':
      return z.string();
    case 'richText':
      return z.union([z.record(z.any()), z.array(z.any())]);
    case 'json':
      return z.any();
    case 'number':
      return o.format === 'decimal' ? z.number().finite() : z.number().int();
    case 'boolean':
      return z.boolean();
    case 'date':
      return z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
    case 'datetime':
      return z.string().datetime({ offset: true });
    case 'money': {
      const currency = o.currencyMode === 'fixed' && o.currency ? z.literal(o.currency) : z.string().regex(/^[A-Z]{3}$/);
      return z.object({ amount: z.number().finite(), currency });
    }
    case 'asset':
    case 'taxonomy':
    case 'reference':
      return isMultiRelation(field) ? z.array(uuid()) : uuid();
    default:
      return z.any();
  }
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

/**
 * Validator for entry input.
 * - `draft`: every field optional and nullable (drafts may be incomplete).
 * - `publish`: required fields must be present and non-empty.
 */
export function buildEntryValidator(def: ContentTypeDefinition, mode: 'draft' | 'publish') {
  const shape: Record<string, ZodTypeAny> = {};
  for (const field of def.fields) {
    const base = fieldValueSchema(field);
    if (mode === 'publish' && field.required) {
      shape[field.name] = base.refine((v) => !isEmpty(v), { message: 'is required' });
    } else {
      shape[field.name] = base.nullable().optional();
    }
  }
  return z.object(shape).strict();
}

export interface EntryValidationIssue {
  path: string;
  message: string;
}

export function validateEntryData(
  def: ContentTypeDefinition,
  data: unknown,
  mode: 'draft' | 'publish',
): { ok: true; data: Record<string, unknown> } | { ok: false; issues: EntryValidationIssue[] } {
  const result = buildEntryValidator(def, mode).safeParse(data ?? {});
  if (result.success) return { ok: true, data: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message })),
  };
}
