import { FileQuestionIcon } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { Button } from '../components/ui/button';
import { Link } from '../lib/nav';
import { t } from '../i18n';

export function NotFound() {
  return (
    <EmptyState
      icon={FileQuestionIcon}
      title={t('notFound.title')}
      description={t('notFound.description')}
      action={
        <Button asChild>
          <Link to="/">{t('notFound.home')}</Link>
        </Button>
      }
    />
  );
}
