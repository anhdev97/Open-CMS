import { isLocale, matchLocale, type Locale } from '@opencms/schema';

export function resolveAdminLocale({
  userLocale,
  stored,
  browser,
}: {
  userLocale?: string | null;
  stored?: string | null;
  browser?: readonly string[];
}): Locale {
  if (isLocale(userLocale)) return userLocale;
  if (isLocale(stored)) return stored;
  return matchLocale(browser);
}
