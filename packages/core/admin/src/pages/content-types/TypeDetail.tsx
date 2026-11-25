import { localizedText, SUPPORTED_LOCALES } from '@opencloudcms/schema';
import { PencilIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Breadcrumbs } from '../../components/Breadcrumbs';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ErrorAlert } from '../../components/ErrorAlert';
import { PageHeader } from '../../components/PageHeader';
import { PrivateLock } from '../../components/PrivateLock';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { getActiveLocale, t } from '../../i18n';
import { api } from '../../lib/api';
import { fromLocalizedText } from '../../lib/content-groups';
import { Link, useAdminNavigate, useAdminParams } from '../../lib/nav';
import type { ApplyResponse, ContentTypeDefinition, Meta } from '../../lib/types';
import { FieldsTable } from './FieldsTable';
import { announceSchemaChange, clearSaveResult, peekSaveResult, typeName, typesPath, TypesSkeleton, useSchemaTypes } from './shared';

/** `/settings/content-types/:apiId`: type info card and fields table (read-only); Edit and Archive in dev. */
export function TypeDetail() {
  const { apiId = '' } = useAdminParams();
  const { meta, types, error } = useSchemaTypes();
  if (error) return <ErrorAlert error={error} />;
  if (!meta || !types) return <TypesSkeleton />;
  const def = types.find((ty) => ty.apiId === apiId);
  if (!def) return <ErrorAlert error={new Error(t('contentTypes.notFound', { apiId }))} />;
  return <DetailView key={def.id} def={def} meta={meta} />;
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-3 sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm sm:col-span-2">{children}</dd>
    </div>
  );
}

function SaveResultCard({ result }: { result: ApplyResponse }) {
  return (
    <Card>
      <CardContent className="space-y-3">
        <Alert variant="success">
          <AlertDescription>
            {result.status === 'created' ? t('builder.resultCreated') : result.status === 'metadata-only' ? t('builder.resultMetadata') : t('builder.resultNothing')}
          </AlertDescription>
        </Alert>
        <p className="text-sm text-muted-foreground">{t('builder.commitFiles')}</p>
        <ul className="space-y-1 font-mono text-xs">
          {result.schemaFile && <li>{result.schemaFile}</li>}
          {result.migrationFile && <li>{result.migrationFile}</li>}
          <li>{t('builder.snapshotFile')}</li>
          {result.generated.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
        {result.warnings.map((w) => (
          <Alert key={w} variant="warning">
            <AlertDescription>{w}</AlertDescription>
          </Alert>
        ))}
      </CardContent>
    </Card>
  );
}

function DetailView({ def, meta }: { def: ContentTypeDefinition; meta: Meta }) {
  const navigate = useAdminNavigate();
  const editable = meta.schemaEditable;
  const [result] = useState(() => peekSaveResult(def.apiId));
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => clearSaveResult(def.apiId), [def.apiId]);

  const locale = getActiveLocale();
  const group = def.group ? meta.groups?.find((g) => g.key === def.group) : undefined;
  const names = fromLocalizedText(def.displayName);
  const table = `ct_${def.apiId.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()}`;

  const archive = async () => {
    setError(null);
    try {
      await api<ApplyResponse>(`/api/admin/content-types/${def.id}`, { method: 'DELETE' });
      announceSchemaChange();
      toast.success(t('builder.archivedToast'));
      navigate(typesPath(), { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: t('contentTypes.listTitle'), to: typesPath() }, { label: typeName(def) }]} />
      <PageHeader
        title={typeName(def)}
        description={def.description}
        adornment={def.private ? <PrivateLock className="ml-2 size-5 align-[-0.125em]" /> : undefined}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link to={`/content/${def.apiId}`}>{t('contentTypes.viewEntries')}</Link>
            </Button>
            {editable && (
              <Button variant="destructive" size="sm" onClick={() => setConfirmArchive(true)}>
                {t('builder.archive')}
              </Button>
            )}
            {editable && (
              <Button asChild size="sm">
                <Link to={typesPath(def.apiId, 'edit')}>
                  <PencilIcon aria-hidden="true" />
                  {t('contentTypes.edit')}
                </Link>
              </Button>
            )}
          </>
        }
      />

      {!editable && (
        <Alert variant="warning">
          <AlertDescription>{t('builder.readOnly')}</AlertDescription>
        </Alert>
      )}
      <ErrorAlert error={error} />
      {result && <SaveResultCard result={result} />}

      <Card>
        <CardHeader>
          <CardTitle>{t('contentTypes.infoCard')}</CardTitle>
          <CardDescription>{t('contentTypes.infoCardDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3">
            <InfoRow label={t('builder.displayName')}>
              <ul className="grid gap-0.5">
                {SUPPORTED_LOCALES.filter((l) => names[l.code]).map((l) => (
                  <li key={l.code}>
                    <span className="text-muted-foreground">{l.name}: </span>
                    {names[l.code]}
                  </li>
                ))}
              </ul>
            </InfoRow>
            <InfoRow label={t('contentTypes.columns.apiId')}>
              <span className="font-mono">{def.apiId}</span>
            </InfoRow>
            <InfoRow label={t('builder.group')}>{group ? localizedText(group.title, locale, group.key) : (def.group ?? t('builder.noGroup'))}</InfoRow>
            <InfoRow label={t('contentTypes.description')}>{def.description || <span className="text-muted-foreground">{t('content.noValue')}</span>}</InfoRow>
            <InfoRow label={t('contentTypes.private')}>{def.private ? t('contentTypes.yes') : t('contentTypes.no')}</InfoRow>
            <InfoRow label={t('builder.review')}>{def.review ? t('contentTypes.yes') : t('contentTypes.no')}</InfoRow>
            <InfoRow label={t('contentTypes.storage')}>
              <span className="font-mono text-xs">{t('builder.idLine', { id: def.id, table })}</span>
            </InfoRow>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('contentTypes.fieldsCard')}</CardTitle>
          <CardDescription>{t('contentTypes.fieldsCardDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {def.fields.length === 0 ? <p className="px-6 text-sm text-muted-foreground">{t('contentTypes.noFields')}</p> : <FieldsTable fields={def.fields} />}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title={t('builder.archiveTitle', { name: typeName(def) })}
        description={t('builder.archiveDescription')}
        confirmLabel={t('builder.archiveConfirm')}
        destructive
        onConfirm={archive}
      />
    </div>
  );
}
