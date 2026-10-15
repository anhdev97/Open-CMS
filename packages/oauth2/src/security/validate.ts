import type { ZodType } from 'zod';
import { AuthError } from '../errors';

/** Validates a request body with zod; failure -> `422 validation_failed` with a short `path: message` list. */
export function parseBody<T>(schema: ZodType<T, any, any>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    throw new AuthError('validation_failed', 422, msg);
  }
  return r.data;
}
