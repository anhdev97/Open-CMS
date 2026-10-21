import type { Locale } from '@opencms/schema';
import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Permission } from '../permissions';

/** What the guard attaches as `request.user` (spec §6.5 step 6, spec B §4.1). */
export interface RequestUser {
  id: string;
  email: string;
  name: string;
  /** Admin UI language; null = not chosen. */
  locale: Locale | null;
  /** Groups the user belongs to, sorted by key. */
  groups: { key: string; name: string }[];
  /** Effective permissions, computed from the groups on every request (spec B §3.3, B10). */
  permissions: Permission[];
  /** Member of a `system` group (Super Admin). */
  isSuperAdmin: boolean;
}

/** Attached as `request.authSession`: identifies the BFF session of the request (e.g. for revokeAll except it). */
export interface RequestAuthSession {
  idHash: string;
}

export const REQUIRED_PERMISSIONS_KEY = 'oauth2:requiredPermissions';

/**
 * The handler (or every handler of the class) requires **all** of `perms`; checked by AuthGuard →
 * `403 forbidden` "Missing permission: <perm>" (spec B §4.1).
 */
export const RequirePermission = (...perms: Permission[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, perms);

export const REQUIRED_ROLES_KEY = 'oauth2:requiredRoles';

/**
 * @deprecated Compat shim until Task 14 moves core to `@RequirePermission`: `'super_admin'` / `'super-admin'`
 * require `isSuperAdmin`; any other key requires membership of the group with that key.
 */
export const RequireRole = (role: string): MethodDecorator & ClassDecorator => SetMetadata(REQUIRED_ROLES_KEY, [role]);

/** `request.user` as set by AuthGuard. Undefined on public routes. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser | undefined => ctx.switchToHttp().getRequest().user,
);
