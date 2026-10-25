import { createTranslator, type Locale } from '@opencloudcms/schema';
import { enUS, type Messages } from './messages/en-US';

export { enUS };
export type { Messages };
export { loadMessages } from './load';

let activeLocale: Locale = 'en-US';
let active: Messages = enUS;
let translate = createTranslator({ 'en-US': enUS }, 'en-US');

/** Swaps the module-level active bundle read by `t`. */
export function setActiveMessages(locale: Locale, messages: Messages): void {
  activeLocale = locale;
  active = messages;
  translate = createTranslator({ 'en-US': enUS, [locale]: messages } as Parameters<typeof createTranslator>[0], locale);
}

export function getActiveLocale(): Locale {
  return activeLocale;
}

/** Looks up a dot path in the active bundle (falling back to en-US) and fills `{name}` placeholders. */
export function t(key: string, vars?: Record<string, string | number>): string {
  return translate(key, vars);
}
