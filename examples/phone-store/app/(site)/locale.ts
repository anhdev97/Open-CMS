import { cookies } from 'next/headers';

export type SiteLocale = 'vi-VN' | 'en-US';

export async function getSiteLocale(): Promise<SiteLocale> {
  const value = (await cookies()).get('oc_site_locale')?.value;
  return value === 'en-US' ? 'en-US' : 'vi-VN';
}
