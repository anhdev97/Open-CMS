import { describe, expect, it } from 'vitest';
import { userActions, type AdminUser } from '../../admin/src/lib/users';

const base: AdminUser = {
  id: 'u1',
  email: 'a@example.com',
  name: 'A',
  status: 'active',
  roles: ['super_admin'],
  lastLoginAt: null,
  identities: [],
};

describe('userActions', () => {
  it('own row: can disable but never delete', () => {
    expect(userActions(base, { id: 'u1' })).toEqual({ canDelete: false, canDisable: true, canEnable: false });
  });
  it('another active user: delete and disable, no enable', () => {
    expect(userActions({ ...base, id: 'u2' }, { id: 'u1' })).toEqual({ canDelete: true, canDisable: true, canEnable: false });
  });
  it('another disabled user: delete and enable, no disable', () => {
    expect(userActions({ ...base, id: 'u2', status: 'disabled' }, { id: 'u1' })).toEqual({
      canDelete: true,
      canDisable: false,
      canEnable: true,
    });
  });
});
