import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';

/** What the guard attaches as `request.user` (spec §6.5 step 6). */
export interface RequestUser {
  id: string;
  email: string;
  name: string;
  roles: string[];
}

/** Attached as `request.authSession`: identifies the BFF session of the request (e.g. for revokeAll except it). */
export interface RequestAuthSession {
  idHash: string;
}

export const REQUIRED_ROLES_KEY = 'oauth2:requiredRoles';

/** The handler (or every handler of the class) requires `role`; checked by AuthGuard → `403 forbidden`. */
export const RequireRole = (role: string): MethodDecorator & ClassDecorator => SetMetadata(REQUIRED_ROLES_KEY, [role]);

/** `request.user` as set by AuthGuard. Undefined on public routes. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser | undefined => ctx.switchToHttp().getRequest().user,
);
