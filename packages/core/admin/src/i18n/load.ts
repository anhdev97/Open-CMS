import type { Locale } from '@opencms/schema';
import { enUS, type Messages } from './messages/en-US';

/** Lazy loaders for non-default bundles. Task 7 adds an entry per file in ./messages. */
const loaders: Partial<Record<Locale, () => Promise<{ default: Messages }>>> = {};

export async function loadMessages(l: Locale): Promise<Messages> {
  const loader = loaders[l];
  if (!loader) return enUS;
  try {
    return (await loader()).default;
  } catch {
    return enUS;
  }
}
