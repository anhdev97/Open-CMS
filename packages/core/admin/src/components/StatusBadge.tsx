import { Badge } from './ui/badge';
import { t } from '../i18n/en';

export type Status = 'draft' | 'published' | 'changed' | 'active' | 'disabled';

const VARIANT = {
  draft: 'secondary',
  published: 'success',
  active: 'success',
  changed: 'warning',
  disabled: 'destructive',
} as const;

export function StatusBadge({ status }: { status: Status }) {
  return <Badge variant={VARIANT[status]}>{t(`status.${status}`)}</Badge>;
}
