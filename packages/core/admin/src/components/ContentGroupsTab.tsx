import { FolderIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { GROUP_KEY_RE, SUPPORTED_LOCALES, localizedText, type ContentGroupDefinition } from '@opencloudcms/schema';
import { getActiveLocale, t } from '../i18n';
import { ApiError } from '../lib/api-error';
import {
  fetchContentGroups,
  fromLocalizedText,
  groupUsage,
  saveContentGroups,
  toLocalizedText,
  type LocaleInputs,
} from '../lib/content-groups';
import type { ContentTypeDefinition } from '../lib/types';
import { ConfirmDialog } from './ConfirmDialog';
import { EmptyState } from './EmptyState';
import { ErrorAlert } from './ErrorAlert';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

interface Props {
  types: ContentTypeDefinition[];
  editable: boolean;
  loaded: boolean;
  /** Called after groups were saved so the Builder can refresh its group select. */
  onChanged: () => void;
}

interface Form {
  /** Key of the group being edited; null when adding. */
  editing: string | null;
  key: string;
  titles: LocaleInputs;
  order: string;
}

const emptyForm = (): Form => ({ editing: null, key: '', titles: { 'en-US': '' }, order: '' });

/** Maps a failed save to a translated error; `group_in_use` lists the types that still use the group. */
function describeError(e: unknown): Error {
  if (e instanceof ApiError && e.code === 'group_in_use') {
    const first = e.issues[0] as { path?: string[]; message?: string } | undefined;
    return new Error(t('groups.inUse', { key: first?.path?.[0] ?? '', types: first?.message ?? '' }));
  }
  return e instanceof Error ? e : new Error(String(e));
}

export function ContentGroupsTab({ types, editable, loaded, onChanged }: Props) {
  const [groups, setGroups] = useState<ContentGroupDefinition[] | null>(null);
  const [canEdit, setCanEdit] = useState(editable);
  const [form, setForm] = useState<Form | null>(null);
  const [formError, setFormError] = useState<Error | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [toDelete, setToDelete] = useState<ContentGroupDefinition | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchContentGroups()
      .then((r) => {
        setGroups(r.groups);
        setCanEdit(r.editable);
      })
      .catch((e) => setError(describeError(e)));
  }, []);

  const usage = groupUsage(groups ?? [], types);
  const locale = getActiveLocale();
  const sorted = [...(groups ?? [])].sort(
    (a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.key.localeCompare(b.key),
  );

  const persist = async (next: ContentGroupDefinition[]): Promise<boolean> => {
    setBusy(true);
    try {
      const r = await saveContentGroups(next);
      setGroups(r.groups);
      window.dispatchEvent(new Event('opencms:schema-changed'));
      onChanged();
      toast.success(t('groups.savedToast'));
      return true;
    } catch (e) {
      const err = describeError(e);
      if (form) setFormError(err);
      else setError(err);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!form || !groups) return;
    const key = form.key.trim();
    const en = (form.titles['en-US'] ?? '').trim();
    if (!form.editing && !GROUP_KEY_RE.test(key)) return setFormError(new Error(t('groups.keyInvalid')));
    if (!form.editing && groups.some((g) => g.key === key)) return setFormError(new Error(t('groups.keyTaken')));
    if (!en) return setFormError(new Error(t('groups.titleRequired')));
    const order = form.order.trim() === '' ? undefined : Number(form.order);
    if (order !== undefined && !Number.isInteger(order)) return setFormError(new Error(t('groups.orderInvalid')));
    const title = toLocalizedText(form.titles);
    const def: ContentGroupDefinition = {
      key: form.editing ?? key,
      title: typeof title === 'string' ? { 'en-US': title } : title,
      ...(order !== undefined ? { order } : {}),
    };
    const next = form.editing ? groups.map((g) => (g.key === form.editing ? def : g)) : [...groups, def];
    setFormError(null);
    setError(null);
    if (await persist(next)) setForm(null);
  };

  const remove = async () => {
    if (!toDelete || !groups) return;
    setError(null);
    await persist(groups.filter((g) => g.key !== toDelete.key));
  };

  const openEdit = (g: ContentGroupDefinition) => {
    setFormError(null);
    setForm({ editing: g.key, key: g.key, titles: fromLocalizedText(g.title), order: g.order === undefined ? '' : String(g.order) });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t('groups.description')}</p>
        {canEdit && (
          <Button
            onClick={() => {
              setFormError(null);
              setForm(emptyForm());
            }}
          >
            <PlusIcon aria-hidden="true" />
            {t('groups.add')}
          </Button>
        )}
      </div>

      {loaded && !canEdit && groups !== null && <p className="text-sm text-muted-foreground">{t('builder.readOnly')}</p>}
      <ErrorAlert error={error} />

      {groups !== null && groups.length === 0 ? (
        <EmptyState icon={FolderIcon} title={t('groups.empty')} />
      ) : (
        groups !== null && (
          <Card>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('groups.key')}</TableHead>
                    <TableHead>{t('groups.title')}</TableHead>
                    <TableHead className="text-right">{t('groups.order')}</TableHead>
                    <TableHead className="text-right">{t('groups.types')}</TableHead>
                    {canEdit && <TableHead className="w-24" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((g) => (
                    <TableRow key={g.key}>
                      <TableCell className="font-mono text-xs">{g.key}</TableCell>
                      <TableCell>{localizedText(g.title, locale, g.key)}</TableCell>
                      <TableCell className="text-right">{g.order ?? '—'}</TableCell>
                      <TableCell className="text-right">{usage[g.key] ?? 0}</TableCell>
                      {canEdit && (
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon-sm" aria-label={t('groups.edit', { key: g.key })} onClick={() => openEdit(g)}>
                              <PencilIcon aria-hidden="true" />
                            </Button>
                            <Button variant="ghost" size="icon-sm" aria-label={t('groups.delete', { key: g.key })} onClick={() => setToDelete(g)}>
                              <Trash2Icon aria-hidden="true" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )
      )}

      <Dialog open={form !== null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form?.editing ? t('groups.editTitle') : t('groups.addTitle')}</DialogTitle>
            <DialogDescription>{t('groups.formHint')}</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="group-key">{t('groups.key')}</Label>
                <Input
                  id="group-key"
                  value={form.key}
                  disabled={form.editing !== null}
                  placeholder="shop"
                  onChange={(e) => setForm({ ...form, key: e.target.value })}
                />
              </div>
              {SUPPORTED_LOCALES.map((l) => (
                <div key={l.code} className="space-y-1">
                  <Label htmlFor={`group-title-${l.code}`} className="font-normal text-muted-foreground">
                    {t('groups.titleIn', { language: l.name })}
                    {l.code === 'en-US' && ` · ${t('builder.requiredShort')}`}
                  </Label>
                  <Input
                    id={`group-title-${l.code}`}
                    value={form.titles[l.code] ?? ''}
                    onChange={(e) => setForm({ ...form, titles: { ...form.titles, [l.code]: e.target.value } })}
                  />
                </div>
              ))}
              <div className="space-y-1">
                <Label htmlFor="group-order">{t('groups.order')}</Label>
                <Input
                  id="group-order"
                  type="number"
                  className="w-28"
                  value={form.order}
                  onChange={(e) => setForm({ ...form, order: e.target.value })}
                />
              </div>
              <ErrorAlert error={formError} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>
              {t('common.cancel')}
            </Button>
            <Button disabled={busy} onClick={submit}>
              {busy ? t('builder.working') : t('groups.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={t('groups.deleteTitle', { name: toDelete ? localizedText(toDelete.title, locale, toDelete.key) : '' })}
        description={t('groups.deleteDescription')}
        confirmLabel={t('common.delete')}
        destructive
        onConfirm={remove}
      />
    </div>
  );
}
