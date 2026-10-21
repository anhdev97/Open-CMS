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
 * The handler (or every handler of the class) requires **all** of the listed permissions; checked by AuthGuard →
 * `403 forbidden` "Missing permission: <perm>" (spec B §4.1). Class-level and method-level requirements are
 * merged (the method adds to the class, it never replaces it), so a method cannot loosen its controller.
 * At least one permission is required at compile time; a route that needs only a session has no decorator.
 */
export const RequirePermission = (first: Permission, ...rest: Permission[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, [first, ...rest]);

/** `request.user` as set by AuthGuard. Undefined on public routes. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser | undefined => ctx.switchToHttp().getRequest().user,
);
