import { SUPPORTED_LOCALES, isLocale } from '@opencms/schema';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { useLocale } from '../i18n/hooks';
import { setAdminLocale } from '../i18n/I18nProvider';
import { t } from '../i18n';

/** Pre-session language picker (Setup, Login): changes the UI and localStorage only, nothing is saved server-side. */
export function LanguageMenu({ className }: { className?: string }) {
  const locale = useLocale();
  return (
    <Select
      value={locale}
      onValueChange={(v) => {
        if (isLocale(v)) void setAdminLocale(v);
      }}
    >
      <SelectTrigger aria-label={t('account.language')} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SUPPORTED_LOCALES.map((l) => (
          <SelectItem key={l.code} value={l.code} lang={l.code}>
            {l.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
