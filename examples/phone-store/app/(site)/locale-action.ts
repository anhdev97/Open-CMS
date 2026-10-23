'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export async function setSiteLocale(formData: FormData) {
  const locale = formData.get('locale');
  if (locale === 'vi-VN' || locale === 'en-US') {
    (await cookies()).set('oc_site_locale', locale, { path: '/', sameSite: 'lax' });
  }
  const next = formData.get('next');
  const path = typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  redirect(path);
}
