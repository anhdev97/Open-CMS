import { zodResolver } from '@hookform/resolvers/zod';
import { GROUP_KEY_RE, SUPPORTED_LOCALES, type ContentGroupDefinition } from '@opencloudcms/schema';
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ErrorAlert } from '../../components/ErrorAlert';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { t } from '../../i18n';
import { fromLocalizedText, toLocalizedText } from '../../lib/content-groups';

interface GroupValues {
  key: string;
  titles: Record<string, string>;
  order: string;
}

const values = (g: ContentGroupDefinition | null): GroupValues => {
  const titles = fromLocalizedText(g?.title);
  return {
    key: g?.key ?? '',
    titles: Object.fromEntries(SUPPORTED_LOCALES.map((l) => [l.code, titles[l.code] ?? ''])),
    order: g?.order === undefined ? '' : String(g.order),
  };
};

function groupSchema(editing: boolean, groups: ContentGroupDefinition[]) {
  return z.object({ key: z.string(), titles: z.record(z.string()), order: z.string() }).superRefine((v, ctx) => {
    const key = v.key.trim();
    if (!editing && !GROUP_KEY_RE.test(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['key'], message: t('groups.keyInvalid') });
    else if (!editing && groups.some((g) => g.key === key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['key'], message: t('groups.keyTaken') });
    if (!(v.titles['en-US'] ?? '').trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['titles', 'en-US'], message: t('groups.titleRequired') });
    if (v.order.trim() !== '' && !Number.isInteger(Number(v.order))) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['order'], message: t('groups.orderInvalid') });
  });
}

interface GroupDialogProps {
  open: boolean;
  /** The group being edited; `null` adds one. */
  editing: ContentGroupDefinition | null;
  groups: ContentGroupDefinition[];
  error: Error | null;
  /** Resolves `true` when saved (the dialog closes). */
  onSubmit: (group: ContentGroupDefinition) => Promise<boolean>;
  onClose: () => void;
}

const ErrorText = ({ id, message }: { id: string; message?: string }) =>
  message ? (
    <p id={id} className="text-sm text-destructive">
      {message}
    </p>
  ) : null;

/** Create or edit a content group (key, titles per locale, order) in a modal Dialog. */
export function GroupDialog({ open, editing, groups, error, onSubmit, onClose }: GroupDialogProps) {
  const schema = useMemo(() => groupSchema(editing !== null, groups), [editing, groups]);
  const form = useForm<GroupValues>({ resolver: zodResolver(schema), defaultValues: values(editing) });
  useEffect(() => {
    if (open) form.reset(values(editing));
  }, [open, editing, form]);
  const errors = form.formState.errors;

  const submit = form.handleSubmit(async (v) => {
    const title = toLocalizedText(v.titles);
    const order = v.order.trim() === '' ? undefined : Number(v.order);
    await onSubmit({
      key: editing?.key ?? v.key.trim(),
      title: typeof title === 'string' ? { 'en-US': title } : title,
      ...(order !== undefined ? { order } : {}),
    });
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? t('groups.editTitle') : t('groups.addTitle')}</DialogTitle>
          <DialogDescription>{t('groups.formHint')}</DialogDescription>
        </DialogHeader>
        <form id="group-form" className="grid gap-3" noValidate onSubmit={submit}>
          <div className="grid gap-1">
            <Label htmlFor="group-key">{t('groups.key')}</Label>
            <Input
              id="group-key"
              disabled={editing !== null}
              placeholder="shop"
              aria-invalid={errors.key ? true : undefined}
              aria-describedby={errors.key ? 'group-key-error' : undefined}
              {...form.register('key')}
            />
            <ErrorText id="group-key-error" message={errors.key?.message} />
          </div>
          {SUPPORTED_LOCALES.map((l) => {
            const err = l.code === 'en-US' ? errors.titles?.['en-US']?.message : undefined;
            return (
              <div key={l.code} className="grid gap-1">
                <Label htmlFor={`group-title-${l.code}`} className="font-normal text-muted-foreground">
                  {t('groups.titleIn', { language: l.name })}
                  {l.code === 'en-US' && ` · ${t('builder.requiredShort')}`}
                </Label>
                <Input
                  id={`group-title-${l.code}`}
                  aria-invalid={err ? true : undefined}
                  aria-describedby={err ? 'group-title-error' : undefined}
                  {...form.register(`titles.${l.code}`)}
                />
                {l.code === 'en-US' && <ErrorText id="group-title-error" message={err} />}
              </div>
            );
          })}
          <div className="grid gap-1">
            <Label htmlFor="group-order">{t('groups.order')}</Label>
            <Input
              id="group-order"
              type="number"
              className="w-28"
              aria-invalid={errors.order ? true : undefined}
              aria-describedby={errors.order ? 'group-order-error' : undefined}
              {...form.register('order')}
            />
            <ErrorText id="group-order-error" message={errors.order?.message} />
          </div>
          <ErrorAlert error={error} />
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="button" disabled={form.formState.isSubmitting} onClick={() => void submit()}>
            {form.formState.isSubmitting ? t('builder.working') : t('groups.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
