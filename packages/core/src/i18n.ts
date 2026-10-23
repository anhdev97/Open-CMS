/**
 * Public i18n API of `@opencms/core`. Also the `react-server` export of the package root: a server component
 * that imports `@opencms/core` gets only this module, without NestJS (see package.json "exports").
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
} from '@opencms/schema';
export type { Locale } from '@opencms/schema';
