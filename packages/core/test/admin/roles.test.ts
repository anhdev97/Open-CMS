import { describe, expect, it } from 'vitest';
import { ApiError } from '../../admin/src/lib/api-error';
import { roleError, roleErrorMessage, roleIdsFromNames, type AdminRole } from '../../admin/src/lib/roles';

const sampleRoles: AdminRole[] = [
  {
    id: '1',
    name: 'super_admin',
    description: '',
    isSystem: true,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: '2',
    name: 'editor',
    description: '',
    isSystem: false,
    createdAt: '',
    updatedAt: '',
  },
];

describe('roleIdsFromNames', () => {
  it('maps known names to ids and ignores unknown names', () => {
    expect(roleIdsFromNames(sampleRoles, ['editor', 'missing', 'super_admin'])).toEqual(['1', '2']);
  });
  it('returns empty when names is empty', () => {
    expect(roleIdsFromNames(sampleRoles, [])).toEqual([]);
  });
});

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
