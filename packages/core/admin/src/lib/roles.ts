import { t } from '../i18n/en';
import { api } from './api';
import { ApiError } from './api-error';

export interface AdminRole {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export const listRoles = () => api<{ data: AdminRole[] }>('/api/admin/roles').then((r) => r.data);

export const createRole = (input: { name: string; description?: string }) =>
  api<AdminRole>('/api/admin/roles', { method: 'POST', json: input });

export const updateRole = (id: string, input: { name?: string; description?: string }) =>
  api<AdminRole>(`/api/admin/roles/${id}`, { method: 'PATCH', json: input });

export const deleteRole = (id: string) => api<void>(`/api/admin/roles/${id}`, { method: 'DELETE' });

export const setUserRoles = (userId: string, roleIds: string[]) =>
  api<{ data: AdminRole[] }>(`/api/admin/users/${userId}/roles`, { method: 'PUT', json: { roleIds } }).then((r) => r.data);

const KNOWN_ERRORS = [
  'role_name_taken',
  'role_in_use',
  'system_role_immutable',
  'forbidden',
  'not_found',
  'validation_failed',
];

/** The en.ts message for a known role-management error code; any other error keeps its own message. */
export function roleErrorMessage(err: unknown): string {
  if (err instanceof ApiError && KNOWN_ERRORS.includes(err.code)) {
    if (err.code === 'role_in_use') return t('roles.errors.role_in_use', { count: err.userCount ?? 0 });
    return t(`roles.errors.${err.code}`);
  }
  return err instanceof Error ? err.message : String(err);
}

/** Same error with a known code's en.ts message; keeps status, issues, retryAfterSec and userCount. Other errors pass through. */
export function roleError(err: unknown): Error {
  if (err instanceof ApiError && KNOWN_ERRORS.includes(err.code)) {
    return new ApiError(
      err.status,
      err.code,
      roleErrorMessage(err),
      err.issues,
      err.retryAfterSec,
      err.userCount,
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}
