import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@opencms/schema';
import { can, landingState, routePermission, visibleSettingsItems } from '../../admin/src/lib/can';
import { settingsItems } from '../../admin/src/navigation';
import { matchRoute } from '../../admin/src/router/match';

describe('can', () => {
  it('checks membership', () => {
    expect(can(['content.read'], 'content.read')).toBe(true);
    expect(can(['content.read'], 'settings.users')).toBe(false);
    expect(can([], 'content.read')).toBe(false);
  });
});

describe('routePermission', () => {
  it('maps guarded routes to permissions', () => {
    expect(routePermission('settingsUsers')).toBe('settings.users');
    expect(routePermission('settingsGroups')).toBe('settings.groups');
    expect(routePermission('settingsContentTypes')).toBe('settings.content-types');
    expect(routePermission('settingsLanguages')).toBe('settings.languages');
    expect(routePermission('content')).toBe('content.read');
  });
  it('leaves other routes open', () => {
    for (const id of ['home', 'account', 'notFound', 'redirectUsers', 'redirectBuilder'] as const) {
      expect(routePermission(id)).toBeUndefined();
    }
  });
  it('matches the groups route', () => {
    expect(matchRoute(['settings', 'groups']).id).toBe('settingsGroups');
  });
});

describe('visibleSettingsItems', () => {
  it('orders Users, Groups, Content types, Languages', () => {
    expect(settingsItems.map((i) => i.to)).toEqual([
      '/settings/users',
      '/settings/groups',
      '/settings/content-types',
      '/settings/languages',
    ]);
  });
  it('shows all items for all permissions', () => {
    expect(visibleSettingsItems(settingsItems, PERMISSIONS)).toHaveLength(4);
  });
  it('hides items without the permission', () => {
    const items = visibleSettingsItems(settingsItems, ['settings.groups', 'content.read']);
    expect(items.map((i) => i.to)).toEqual(['/settings/groups']);
  });
  it('is empty when nothing is allowed (caller hides the Settings group)', () => {
    expect(visibleSettingsItems(settingsItems, ['content.read'])).toEqual([]);
  });
});

describe('landingState', () => {
  it('shows content with content.read', () => {
    expect(landingState(['content.read'])).toBe('content');
  });
  it('shows the settings welcome for settings-only users', () => {
    expect(landingState(['settings.users'])).toBe('settings');
  });
  it('is forbidden with nothing usable', () => {
    expect(landingState([])).toBe('forbidden');
    expect(landingState(['content.create'])).toBe('forbidden');
  });
});
