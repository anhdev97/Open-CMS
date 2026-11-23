import { isLocale, matchLocale, validatePagePath, type Locale } from '@opencloudcms/schema';

/** Locale of the draft being previewed (set by the preview route, cleared by the exit route). */
export const PREVIEW_LOCALE_COOKIE = 'opencloudcms_preview_locale';
export const PREVIEW_PATH = '/__opencloudcms/preview';
export const PREVIEW_EXIT_PATH = '/__opencloudcms/preview/exit';
/** Every response produced while draft mode is on (and every preview/exit answer). */
export const NO_STORE = 'private, no-store';

/** Loopback base URL of the Nest API (same process, same port). Read per call so `PORT` set after import counts. */
export const resolveBaseUrl = (baseUrl?: string): string =>
  (baseUrl ?? `http://127.0.0.1:${process.env.PORT ?? 4000}`).replace(/\/+$/, '');

/** A path a page can have (spec path rule, reserved prefixes excluded). Anything else is never fetched or redirected to. */
export const isPagePath = (v: unknown): v is string => typeof v === 'string' && validatePagePath(v).ok;

export const asLocale = (v: unknown): Locale | undefined => (isLocale(v) ? v : undefined);

/** Locale for website copy when the content locale is unknown (no session): the visitor's Accept-Language. */
export const copyLocale = (acceptLanguage: string | null | undefined): Locale => matchLocale(acceptLanguage);

export const exitUrl = (path: string): string => `${PREVIEW_EXIT_PATH}?path=${encodeURIComponent(path)}`;
