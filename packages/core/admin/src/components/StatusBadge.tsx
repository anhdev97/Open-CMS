import { Badge } from './ui/badge';
import { t } from '../i18n';

export type Status = 'draft' | 'in_review' | 'published' | 'changed' | 'active' | 'disabled';

const VARIANT = {
  draft: 'secondary',
  in_review: 'warning',
  published: 'success',
  active: 'success',
  changed: 'warning',
  disabled: 'destructive',
} as const;

export function StatusBadge({ status }: { status: Status }) {
  return <Badge variant={VARIANT[status]}>{t(`status.${status}`)}</Badge>;
}
