import type { Permission } from '@opencms/schema';
import { useAuth } from '../auth/AuthContext';
import { settingsItems } from '../navigation';
import type { RouteId } from '../router/match';

/** True when the effective permission list holds `p`. Pure. */
export function can(perms: readonly string[], p: Permission): boolean {
  return perms.includes(p);
}

/** `can` bound to the signed-in user (`/api/auth/me`). Must run inside AuthGate. */
export function useCan(): (p: Permission) => boolean {
  const { user } = useAuth();
  return (p) => can(user.permissions, p);
}

const ROUTE_PERMISSIONS: Partial<Record<RouteId, Permission>> = {
  settingsUsers: 'settings.users',
  settingsGroups: 'settings.groups',
  settingsContentTypes: 'settings.content-types',
  settingsLanguages: 'settings.languages',
  content: 'content.read',
  assets: 'content.read',
};

/** The permission a route needs; `undefined` means any signed-in user. */
export function routePermission(id: RouteId): Permission | undefined {
  return ROUTE_PERMISSIONS[id];
}

/** Settings items the user may open; empty means the caller hides the whole Settings group. */
export function visibleSettingsItems<T extends { permission?: Permission }>(items: readonly T[], perms: readonly string[]): T[] {
  return items.filter((i) => !i.permission || can(perms, i.permission));
}

export type LandingState = 'content' | 'settings' | 'forbidden';

/** What Home shows: the content list, a Settings welcome, or the forbidden notice. */
export function landingState(perms: readonly string[]): LandingState {
  if (can(perms, 'content.read')) return 'content';
  return visibleSettingsItems(settingsItems, perms).length > 0 ? 'settings' : 'forbidden';
}
