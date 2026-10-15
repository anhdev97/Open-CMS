// Thin wrappers over `/api/admin/users*` and `/api/auth/password`. Relative imports only (ruling R4).
import { t } from '../i18n/en';
import { api } from './api';
import { ApiError } from './api-error';

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  status: 'active' | 'disabled' | string;
  roles: string[];
  lastLoginAt: string | null;
  identities: Array<{ id: string; provider: string; subject: string; email: string | null }>;
}

export interface UserActions {
  canDelete: boolean;
  canDisable: boolean;
  canEnable: boolean;
}

/** Which row actions apply: no delete on your own row, disable only when active, enable only when disabled. */
export function userActions(row: Pick<AdminUser, 'id' | 'status'>, me: { id: string }): UserActions {
  return {
    canDelete: row.id !== me.id,
    canDisable: row.status === 'active',
    canEnable: row.status === 'disabled',
  };
}

const base = '/api/admin/users';

export const listUsers = () => api<{ data: AdminUser[] }>(base).then((r) => r.data);

export const createUser = (input: { email: string; name: string; password?: string }) =>
  api<{ data: AdminUser }>(base, { method: 'POST', json: input }).then((r) => r.data);

export const setUserStatus = (id: string, status: 'active' | 'disabled') =>
  api<{ data: AdminUser }>(`${base}/${id}`, { method: 'PATCH', json: { status } }).then((r) => r.data);

export const resetUserPassword = (id: string, password: string) =>
  api<void>(`${base}/${id}/password`, { method: 'POST', json: { password } });

export const deleteUser = (id: string) => api<void>(`${base}/${id}`, { method: 'DELETE' });

export const unlinkIdentity = (id: string, identityId: string) =>
  api<void>(`${base}/${id}/identities/${identityId}`, { method: 'DELETE' });

export const changePassword = (currentPassword: string, newPassword: string) =>
  api<void>('/api/auth/password', { method: 'POST', json: { currentPassword, newPassword } });

const KNOWN_ERRORS = ['last_super_admin', 'email_taken', 'forbidden', 'not_found', 'weak_password'];

/** The en.ts message for a known user-management error code; any other error keeps its own message. */
export function userErrorMessage(err: unknown): string {
  if (err instanceof ApiError && KNOWN_ERRORS.includes(err.code)) return t(`users.errors.${err.code}`);
  return err instanceof Error ? err.message : String(err);
}
