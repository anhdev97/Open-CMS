// Thin wrappers over `/api/admin/groups*` and `/api/admin/permissions`. Relative imports only (ruling R4).
import { PERMISSIONS, type Permission } from '@opencms/schema';
import { t } from '../i18n';
import { api } from './api';
import { ApiError } from './api-error';

export interface AdminGroup {
  id: string;
  key: string;
  name: string;
  roles: Permission[];
  system: boolean;
  userCount: number;
}

/** Seed group keys that have translated names (`groups.<key>`). */
const SEED_KEYS = ['super-admin', 'contenter', 'reviewer'];

export const isSeedGroupKey = (key: string) => SEED_KEYS.includes(key);

/** PATCH body: `name` only when the user changed it (seed groups keep their stored name; their shown name is a translation). */
export function groupUpdateInput(
  group: Pick<AdminGroup, 'key' | 'name'>,
  name: string,
  roles: Permission[],
): { name?: string; roles: Permission[] } {
  const trimmed = name.trim();
  const changed = !isSeedGroupKey(group.key) && trimmed !== group.name;
  return changed ? { name: trimmed, roles } : { roles };
}

/** Display name: seed groups use the translation for their key, custom groups keep their own name. */
export function groupName(g: { key: string; name: string }): string {
  return SEED_KEYS.includes(g.key) ? t(`groups.${g.key}`) : g.name;
}

/** Permissions shown as two sections in the editor. */
export const PERMISSION_SECTIONS: { id: 'content' | 'settings'; permissions: Permission[] }[] = [
  { id: 'content', permissions: PERMISSIONS.filter((p) => p.startsWith('content.')) },
  { id: 'settings', permissions: PERMISSIONS.filter((p) => p.startsWith('settings.')) },
];

const base = '/api/admin/groups';

export const listGroups = () => api<{ data: AdminGroup[] }>(base).then((r) => r.data);

export const createGroup = (input: { key: string; name: string; roles: Permission[] }) =>
  api<{ data: AdminGroup }>(base, { method: 'POST', json: input }).then((r) => r.data);

export const updateGroup = (id: string, input: { name?: string; roles?: Permission[] }) =>
  api<{ data: AdminGroup }>(`${base}/${id}`, { method: 'PATCH', json: input }).then((r) => r.data);

export const deleteGroup = (id: string) => api<void>(`${base}/${id}`, { method: 'DELETE' });

const KNOWN_ERRORS = ['system_group', 'group_key_taken', 'group_in_use', 'forbidden', 'last_super_admin', 'not_found'];

/** Same error with a known code's active-locale message; keeps status, issues and retryAfterSec. */
export function groupError(err: unknown): Error {
  if (err instanceof ApiError && KNOWN_ERRORS.includes(err.code)) {
    return new ApiError(err.status, err.code, t(`permGroups.errors.${err.code}`), err.issues, err.retryAfterSec);
  }
  return err instanceof Error ? err : new Error(String(err));
}
