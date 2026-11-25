import { useState } from 'react';
import { Breadcrumbs } from '../../components/Breadcrumbs';
import { ErrorAlert } from '../../components/ErrorAlert';
import { PageHeader } from '../../components/PageHeader';
import { PrivateLock } from '../../components/PrivateLock';
import { StatusBadge } from '../../components/StatusBadge';
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Skeleton } from '../../components/ui/skeleton';
import { t } from '../../i18n';
import { useFormat } from '../../i18n/hooks';
import { useAdminNavigate, useAdminParams } from '../../lib/nav';
import { EntryFieldsCards } from './EntryFieldsCards';
import { detailActions, ReviewActions } from './ReviewActions';
import { useAuth } from '../../auth/AuthContext';
import {
  contentPath,
  entryStatus,
  entryTitle,
  formValues,
  typeTitle,
  useContentType,
  useEditorLocale,
  useEntry,
  useEntryFiles,
  useVersions,
} from './useEntry';

export function PageSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      <Skeleton className="h-5 w-64" />
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

/** `/content/:apiId/:documentId`: read-only field cards, status card, workflow actions. */
export function ContentDetail() {
  const { apiId = '', documentId = '' } = useAdminParams();
  return <DetailView key={`${apiId}/${documentId}`} apiId={apiId} documentId={documentId} />;
}

function DetailView({ apiId, documentId }: { apiId: string; documentId: string }) {
  const { formatDateTime } = useFormat();
  const { user } = useAuth();
  const navigate = useAdminNavigate();
  const { def, meta, error: typeError } = useContentType(apiId);
  const [locale, setLocale] = useEditorLocale(meta, def);
  const { entry, error: entryError, reload } = useEntry(apiId, documentId, locale);
  const files = useEntryFiles(def, documentId);
  const [refresh, setRefresh] = useState(0);
  const versions = useVersions(def, documentId, refresh);
  const [error, setError] = useState<Error | null>(null);

  if (typeError || entryError) return <ErrorAlert error={typeError ?? entryError} />;
  if (!def || !meta || !entry) return <PageSkeleton />;

  const isPrivate = !!def.private;
  const listTo = contentPath(apiId, [], locale, meta.defaultLocale);
  const title = entryTitle(def, entry);
  const { locked } = detailActions(def, entry, user);
  const rejection = !isPrivate && entry.workflow?.state === 'draft' && entry.workflow.note ? entry.workflow : null;
  const inReview = !isPrivate && !!def.review && entry.workflow?.state === 'in_review' ? entry.workflow : null;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: typeTitle(def), to: listTo }, { label: title }]} />
      <PageHeader
        title={title}
        adornment={isPrivate ? <PrivateLock className="ml-2 size-5 align-[-0.125em]" /> : undefined}
        actions={
          <ReviewActions
            def={def}
            entry={entry}
            editTo={contentPath(apiId, [documentId, 'edit'], locale, meta.defaultLocale)}
            onError={setError}
            onChanged={async () => {
              await reload();
              setRefresh((r) => r + 1);
            }}
            onDeleted={() => navigate(listTo)}
          />
        }
      />

      <ErrorAlert error={error} />
      {rejection && (
        <Alert variant="destructive" role="status">
          <AlertTitle>{t('content.rejectedBanner', { name: rejection.submittedBy?.name ?? t('content.noValue') })}</AlertTitle>
          <AlertDescription>{rejection.note}</AlertDescription>
        </Alert>
      )}
      {inReview && (
        <Alert role="status">
          <AlertTitle>
            {t('content.inReviewBanner', {
              name: inReview.submittedBy?.name ?? t('content.noValue'),
              date: inReview.submittedAt ? formatDateTime(inReview.submittedAt) : t('content.noValue'),
            })}
          </AlertTitle>
          {locked && <AlertDescription>{t('content.lockedHint')}</AlertDescription>}
        </Alert>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <EntryFieldsCards key={`${locale}:${entry.updatedAt ?? ''}`} def={def} locale={locale} files={files} values={formValues(def, entry)} />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{t('content.statusCard')}</CardTitle>
            <CardDescription>{isPrivate ? t('content.privateStatusDescription') : t('content.statusDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm">
            {!isPrivate && (
              <div className="grid gap-1.5">
                <span className="text-muted-foreground">{t('content.statusColumn')}</span>
                <div className="flex flex-wrap gap-1">
                  <StatusBadge status={entryStatus(def, entry)} />
                  {entry.publishedAt && entry.hasUnpublishedChanges && <StatusBadge status="changed" />}
                </div>
              </div>
            )}
            <div className="grid gap-1.5">
              <span className="text-muted-foreground">{t('content.updatedAt')}</span>
              <span>{entry.updatedAt ? formatDateTime(entry.updatedAt) : t('content.noValue')}</span>
            </div>
            {!isPrivate && (
              <div className="grid gap-1.5">
                <Label htmlFor="entry-locale" className="font-normal text-muted-foreground">
                  {t('content.locale')}
                </Label>
                <Select value={locale} onValueChange={setLocale}>
                  <SelectTrigger id="entry-locale" size="sm" aria-label={t('content.locale')} className="w-full">
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
              </div>
            )}
            {!isPrivate && (
              <div className="grid gap-1.5">
                <span className="text-muted-foreground">{t('content.versions')}</span>
                {versions === null ? (
                  <Skeleton className="h-5 w-full" />
                ) : versions.length === 0 ? (
                  <span className="text-muted-foreground">{t('content.noVersions')}</span>
                ) : (
                  <ol className="grid gap-1">
                    {versions.slice(0, 10).map((v) => (
                      <li key={v.id}>{formatDateTime(v.createdAt)}</li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
