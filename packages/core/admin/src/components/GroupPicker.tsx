import { useEffect, useState } from 'react';
import { Checkbox } from './ui/checkbox';
import { Label } from './ui/label';
import { Skeleton } from './ui/skeleton';
import { t } from '../i18n';
import { groupName, listGroups, type AdminGroup } from '../lib/groups';

/** Multi-select of permission groups as a checkbox list. */
export function GroupPicker({
  value,
  onChange,
  idPrefix,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  idPrefix: string;
}) {
  const [groups, setGroups] = useState<AdminGroup[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    listGroups().then(
      (rows) => live && setGroups(rows),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, []);

  if (failed) return <p className="text-sm text-destructive">{t('users.groupsLoadFailed')}</p>;
  if (!groups) return <Skeleton className="h-16 w-full" aria-hidden="true" />;
  return (
    <div className="grid gap-2" role="group" aria-label={t('users.groups')}>
      {groups.map((g) => {
        const id = `${idPrefix}-${g.id}`;
        return (
          <div key={g.id} className="flex items-center gap-2">
            <Checkbox
              id={id}
              checked={value.includes(g.id)}
              onCheckedChange={(on) => onChange(on === true ? [...value, g.id] : value.filter((x) => x !== g.id))}
            />
            <Label htmlFor={id}>{groupName(g)}</Label>
          </div>
        );
      })}
    </div>
  );
}
