import { describe, expect, it } from 'vitest';
import { ApiError } from '../../admin/src/lib/api-error';
import { roleError, roleErrorMessage } from '../../admin/src/lib/roles';

describe('roleErrorMessage', () => {
  it('formats role_in_use with count', () => {
    const err = new ApiError(409, 'role_in_use', 'Role is assigned to 3 user(s)', [], undefined, 3);
    expect(roleErrorMessage(err)).toBe('This role is assigned to 3 user(s). Remove those assignments first.');
  });
  it('maps role_name_taken', () => {
    expect(roleErrorMessage(new ApiError(409, 'role_name_taken', 'x'))).toBe('A role with this name already exists.');
  });
});

describe('roleError', () => {
  it('rewrites known codes and preserves userCount', () => {
    const e = roleError(new ApiError(409, 'role_in_use', 'x', [], undefined, 2)) as ApiError;
    expect(e.userCount).toBe(2);
    expect(e.message).toContain('2');
  });
});
