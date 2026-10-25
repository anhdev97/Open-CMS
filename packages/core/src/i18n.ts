/**
 * Public i18n API of `@opencloudcms/core`. Also the `react-server` export of the package root: a server component
 * that imports `@opencloudcms/core` gets only this module, without NestJS (see package.json "exports").
 */
export {
  SUPPORTED_LOCALES,
  isLocale,
  matchLocale,
  localizedText,
  defineMessages,
  createTranslator,
  formatDateTime,
  formatNumber,
} from '@opencloudcms/schema';
export type { Locale } from '@opencloudcms/schema';
