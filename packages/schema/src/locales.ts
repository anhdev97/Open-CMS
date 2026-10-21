import { isLocale, type Locale } from './i18n';

export interface LocaleSettings {
  defaultLocale: Locale;
  locales: Locale[];
}

const HINT = 'use one of en-US, vi-VN, fr-FR, id-ID';

/** Returns issue messages; empty when valid. */
export function validateLocaleSettings(s: { defaultLocale?: unknown; locales?: unknown }): string[] {
  const issues: string[] = [];
  const { defaultLocale, locales } = s ?? {};
  if (!Array.isArray(locales) || locales.length === 0) {
    issues.push('locales must be a non-empty list');
  } else {
    const seen = new Set<unknown>();
    for (const l of locales) {
      if (!isLocale(l)) issues.push(`locale ${JSON.stringify(l)} is not supported (${HINT})`);
      else if (seen.has(l)) issues.push(`locale "${l}" is listed more than once`);
      seen.add(l);
    }
  }
  if (!isLocale(defaultLocale)) {
    issues.push(`defaultLocale ${JSON.stringify(defaultLocale)} is not supported (${HINT})`);
  } else if (Array.isArray(locales) && locales.length && !locales.includes(defaultLocale)) {
    issues.push(`defaultLocale "${defaultLocale}" must be one of the enabled locales`);
  }
  return issues;
}

export function defineLocales(s: LocaleSettings): LocaleSettings {
  const issues = validateLocaleSettings(s);
  if (issues.length) throw new Error(`Invalid locale settings:\n  - ${issues.join('\n  - ')}`);
  return s;
}
