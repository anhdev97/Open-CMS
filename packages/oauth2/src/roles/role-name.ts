import { AuthError } from '../errors';

export const ROLE_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

export function validateRoleName(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new AuthError('validation_failed', 422, 'name: required');
  }
  const name = raw.trim();
  if (!name) throw new AuthError('validation_failed', 422, 'name: required');
  if (name.length > 64) throw new AuthError('validation_failed', 422, 'name: max length 64');
  if (!ROLE_NAME_PATTERN.test(name)) {
    throw new AuthError(
      'validation_failed',
      422,
      'name: must match ^[a-z][a-z0-9_]*$ (snake_case ASCII)',
    );
  }
  return name;
}
