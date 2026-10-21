import { PERMISSIONS, isPermission, type Permission } from '@opencms/schema';

export { PERMISSIONS, isPermission, type Permission };

/** Key of the built-in system group (spec B §3.2). */
export const SUPER_ADMIN_GROUP = 'super-admin';

/**
 * Effective permissions of a user from their groups (spec B §3.3): any `system` group → every permission;
 * otherwise the sorted, de-duplicated union of the groups' roles, unknown entries dropped.
 */
export function effectivePermissions(groups: ReadonlyArray<{ system: boolean; roles: readonly string[] }>): Permission[] {
  if (groups.some((g) => g.system)) return [...PERMISSIONS].sort();
  const out = new Set<Permission>();
  for (const g of groups) for (const r of g.roles) if (isPermission(r)) out.add(r);
  return [...out].sort();
}
