import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { useAuth } from '../../auth/AuthContext';
import { Breadcrumbs, type Crumb } from '../../components/Breadcrumbs';
import { ErrorAlert } from '../../components/ErrorAlert';
import type { EntryFile } from '../../components/FieldInput';
import { PageHeader } from '../../components/PageHeader';
import { PrivateLock } from '../../components/PrivateLock';
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Form } from '../../components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { t } from '../../i18n';
import { api } from '../../lib/api';
import { formLocked } from '../../lib/entry-actions';
import { Link, useAdminNavigate, useAdminParams } from '../../lib/nav';
import { confirmNavigation } from '../../lib/nav-guard';
import type { ContentTypeDefinition, Meta } from '../../lib/types';
import { PageSkeleton } from './ContentDetail';
import { EntryFieldsCards } from './EntryFieldsCards';
import {
  contentPath,
  entrySchema,
  entryTitle,
  fieldIssues,
  formValues,
  typeTitle,
  useContentType,
  useEditorLocale,
  useEntry,
  useEntryFiles,
  useUnsavedChangesGuard,
  workflowError,
  writableBody,
  type Entry,
  type Values,
} from './useEntry';

interface EntryFormProps {
  def: ContentTypeDefinition;
  meta: Meta;
  locale: string;
  entry: Entry | null;
  files: EntryFile[];
  crumbs: Crumb[];
  title: string;
  cancelTo: string;
  locked?: boolean;
  /** Header controls next to the title (the locale select on edit). */
  actions?: ReactNode;
  banner?: ReactNode;
  save: (body: Values) => Promise<Entry>;
  onSaved: (saved: Entry) => void;
}

/** Shared by new and edit: field cards in a react-hook-form + zod form, sticky Save bar, unsaved-changes guard. */
export function EntryForm({ def, locale, entry, files, crumbs, title, cancelTo, locked = false, actions, banner, save, onSaved }: EntryFormProps) {
  const schema = useMemo(() => entrySchema(def), [def]);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: formValues(def, entry) });
  const [formError, setFormError] = useState<Error | null>(null);
  const dirty = form.formState.isDirty;
  const release = useUnsavedChangesGuard(dirty);
  const submitting = form.formState.isSubmitting;

  async function onSubmit(values: Values) {
    setFormError(null);
    try {
      const saved = await save(writableBody(def, values));
      toast.success(t('content.saved'));
      release();
      onSaved(saved);
    } catch (e) {
      const issues = fieldIssues(def, e);
      for (const { field, message } of issues) form.setError(field.name, { message });
      if (!issues.length) setFormError(workflowError(e));
    }
  }

  return (
    <Form {...form}>
      <form className="space-y-6" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <Breadcrumbs items={crumbs} />
        <PageHeader title={title} adornment={def.private ? <PrivateLock className="ml-2 size-5 align-[-0.125em]" /> : undefined} actions={actions} />
        <ErrorAlert error={formError} />
        {banner}
        <EntryFieldsCards def={def} locale={locale} files={files} form={form} locked={locked} />
        <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
          {dirty && (
            <p className="mr-auto text-sm text-muted-foreground" role="status">
              {t('content.unsavedBar')}
            </p>
          )}
          <Button asChild variant="outline">
            <Link to={cancelTo}>{t('content.cancel')}</Link>
          </Button>
          <Button type="submit" disabled={locked || submitting}>
            {submitting ? t('content.saving') : t('content.save')}
          </Button>
        </div>
      </form>
    </Form>
  );
}

/** `/content/:apiId/:documentId/edit`: field cards, locale select, sticky Save bar; Save returns to the detail page. */
export function ContentEdit() {
  const { apiId = '', documentId = '' } = useAdminParams();
  return <EditView key={`${apiId}/${documentId}`} apiId={apiId} documentId={documentId} />;
}

function EditView({ apiId, documentId }: { apiId: string; documentId: string }) {
  const { user } = useAuth();
  const navigate = useAdminNavigate();
  const { def, meta, error: typeError } = useContentType(apiId);
  const [locale, setLocale] = useEditorLocale(meta, def);
  const { entry, error: entryError } = useEntry(apiId, documentId, locale);
  const files = useEntryFiles(def, documentId);

  if (typeError || entryError) return <ErrorAlert error={typeError ?? entryError} />;
  if (!def || !meta || !entry) return <PageSkeleton />;

  const detailTo = contentPath(apiId, [documentId], locale, meta.defaultLocale);
  const locked =
    !def.private &&
    formLocked({ review: !!def.review, workflow: entry.workflow ?? null, published: !!entry.publishedAt, permissions: user.permissions, userId: user.id });
  const title = entryTitle(def, entry);

  return (
    <EntryForm
      key={`${locale}:${entry.documentId}:${entry.updatedAt ?? ''}`}
      def={def}
      meta={meta}
      locale={locale}
      entry={entry}
      files={files}
      title={t('content.editEntry')}
      crumbs={[{ label: typeTitle(def), to: contentPath(apiId, [], locale, meta.defaultLocale) }, { label: title, to: detailTo }, { label: t('content.edit') }]}
      cancelTo={detailTo}
      locked={locked}
      banner={
        locked ? (
          <Alert role="status">
            <AlertTitle>{t('content.lockedHint')}</AlertTitle>
            <AlertDescription>{t('content.errors.in_review_locked')}</AlertDescription>
          </Alert>
        ) : undefined
      }
      actions={
        def.private ? undefined : (
          <Select value={locale} onValueChange={(l) => confirmNavigation() && setLocale(l)}>
            <SelectTrigger size="sm" aria-label={t('content.locale')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {meta.locales.map((l) => (
                <SelectItem key={l} value={l}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      }
      save={async (body) =>
        (
          await api<{ data: Entry }>(`/api/admin/content/${apiId}/${documentId}?locale=${locale}`, {
            method: 'PATCH',
            json: body,
          })
        ).data
      }
      onSaved={() => navigate(detailTo)}
    />
  );
}
