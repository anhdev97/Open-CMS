import type { Locale } from '@opencloudcms/schema';
import { enUS, type Messages } from './messages/en-US';

/** Lazy loaders for non-default bundles (one entry per file in ./messages). */
const loaders: Partial<Record<Locale, () => Promise<{ default: Messages }>>> = {
  'vi-VN': () => import('./messages/vi-VN'),
  'fr-FR': () => import('./messages/fr-FR'),
  'id-ID': () => import('./messages/id-ID'),
};

export async function loadMessages(l: Locale): Promise<Messages> {
  const loader = loaders[l];
  if (!loader) return enUS;
  try {
    return (await loader()).default;
  } catch {
    return enUS;
  }
}
