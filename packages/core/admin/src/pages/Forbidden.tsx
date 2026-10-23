import { ShieldAlertIcon } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { t } from '../i18n';

export function Forbidden() {
  return <EmptyState icon={ShieldAlertIcon} title={t('forbidden.title')} description={t('forbidden.description')} />;
}
