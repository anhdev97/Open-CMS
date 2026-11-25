import { BlocksIcon, FileTextIcon, LanguagesIcon, PaletteIcon, ShieldCheckIcon, UsersIcon, WrenchIcon, type LucideIcon } from 'lucide-react';
import type { Permission } from '@opencloudcms/schema';

export interface SettingsItem {
  to: string;
  /** i18n key */
  label: string;
  icon: LucideIcon;
  /** Permission needed to see the item (the server enforces it too). */
  permission?: Permission;
}

export const settingsItems: SettingsItem[] = [
  { to: '/settings/users', label: 'nav.users', icon: UsersIcon, permission: 'settings.users' },
  { to: '/settings/groups', label: 'nav.groups', icon: ShieldCheckIcon, permission: 'settings.groups' },
  { to: '/settings/content-types', label: 'nav.contentTypesSettings', icon: WrenchIcon, permission: 'settings.content-types' },
  { to: '/settings/languages', label: 'nav.languages', icon: LanguagesIcon, permission: 'settings.languages' },
];

/** "Page builder" group shown above the content groups: pages and the blocks they are built from. */
export const pageBuilderItems: SettingsItem[] = [
  { to: '/pages', label: 'nav.pages', icon: FileTextIcon, permission: 'content.read' },
  { to: '/settings/blocks', label: 'nav.blocks', icon: BlocksIcon, permission: 'settings.content-types' },
  { to: '/settings/theme', label: 'nav.theme', icon: PaletteIcon, permission: 'settings.content-types' },
];
