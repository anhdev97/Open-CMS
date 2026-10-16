import { describe, expect, it } from 'vitest';
import { validateRoleName } from '../../src/roles/role-name';

describe('validateRoleName', () => {
  it('accepts snake_case identifiers', () => {
    expect(validateRoleName(' editor ')).toBe('editor');
    expect(validateRoleName('content_editor')).toBe('content_editor');
    expect(validateRoleName('a')).toBe('a');
  });

  it('rejects empty, too long, and bad patterns', () => {
    for (const raw of ['', '   ', 'Editor', '1abc', 'ab-c', 'ab.c', 'a'.repeat(65)]) {
      expect(() => validateRoleName(raw)).toThrowError(
        expect.objectContaining({ code: 'validation_failed', status: 422 }),
      );
    }
  });
});
