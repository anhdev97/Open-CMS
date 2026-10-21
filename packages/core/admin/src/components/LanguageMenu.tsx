import { SUPPORTED_LOCALES, isLocale } from '@opencms/schema';
import { useLocale } from '../i18n/hooks';
import { setAdminLocale } from '../i18n/I18nProvider';
import { t } from '../i18n';

/** Pre-session language picker (Setup, Login): changes the UI and localStorage only, nothing is saved server-side. */
export function LanguageMenu({ className }: { className?: string }) {
  const locale = useLocale();
  return (
    <select
      aria-label={t('account.language')}
      className={
        'h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ' +
        (className ?? '')
      }
      value={locale}
      onChange={(e) => {
        if (isLocale(e.target.value)) void setAdminLocale(e.target.value);
      }}
    >
      {SUPPORTED_LOCALES.map((l) => (
        <option key={l.code} value={l.code} lang={l.code}>
          {l.name}
        </option>
      ))}
    </select>
  );
}
