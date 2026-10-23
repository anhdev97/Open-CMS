import { describe, expect, it } from 'vitest';
import { ApiError } from '../../admin/src/lib/api-error';
import { userActions, userError, type AdminUser } from '../../admin/src/lib/users';

const base: AdminUser = {
  id: 'u1',
  email: 'a@example.com',
  name: 'A',
  status: 'active',
  groups: [{ id: 'g1', key: 'super-admin', name: 'Super Admin' }],
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

describe('userError', () => {
  it('maps a known code and keeps retryAfterSec and issues', () => {
    const e = userError(new ApiError(409, 'email_taken', 'email_taken', [1], 7)) as ApiError;
    expect(e.message).toBe('A user with this email already exists.');
    expect([e.status, e.code, e.issues, e.retryAfterSec]).toEqual([409, 'email_taken', [1], 7]);
  });
  it('passes unknown errors through', () => {
    const raw = new ApiError(500, 'boom', 'Boom');
    expect(userError(raw)).toBe(raw);
  });
});
