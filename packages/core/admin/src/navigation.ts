import { LanguagesIcon, UsersIcon, WrenchIcon, type LucideIcon } from 'lucide-react';

export interface SettingsItem {
  to: string;
  /** i18n key */
  label: string;
  icon: LucideIcon;
  /** Required permission; enforced from the permissions task onwards. */
  permission?: string;
}

export const settingsItems: SettingsItem[] = [
  { to: '/settings/users', label: 'nav.users', icon: UsersIcon },
  { to: '/settings/content-types', label: 'nav.contentTypesSettings', icon: WrenchIcon },
  { to: '/settings/languages', label: 'nav.languages', icon: LanguagesIcon },
];
