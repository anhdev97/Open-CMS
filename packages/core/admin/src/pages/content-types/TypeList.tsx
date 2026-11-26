import { localizedText } from '@opencloudcms/schema';
import { FolderIcon, PlusIcon, WrenchIcon } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import { ErrorAlert } from '../../components/ErrorAlert';
import { PageHeader } from '../../components/PageHeader';
import { PrivateLock } from '../../components/PrivateLock';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { getActiveLocale, t } from '../../i18n';
import { Link, Redirect, useAdminNavigate, useAdminSearchParam } from '../../lib/nav';
import { BoolMark, typeName, typesPath, TypesSkeleton, useSchemaTypes } from './shared';

/** `/settings/content-types`: every type with group, field count, private and review; "New" in dev. */
export function TypeList() {
  const oldType = useAdminSearchParam('type');
  const oldTab = useAdminSearchParam('tab');
  // Old single-page links (`?type=x`, `?tab=groups`) land on the matching sub-page.
  if (oldType) return <Redirect to={typesPath(oldType)} />;
  if (oldTab === 'groups') return <Redirect to={typesPath('groups')} />;
  return <ListView />;
}

function ListView() {
  const navigate = useAdminNavigate();
  const { meta, types, error } = useSchemaTypes();
  if (error) return <ErrorAlert error={error} />;
  if (!meta || !types) return <TypesSkeleton />;

  const editable = meta.schemaEditable;
  const locale = getActiveLocale();
  const groupTitle = (key: string | undefined) => {
    if (!key) return null;
    const g = meta.groups?.find((x) => x.key === key);
    return g ? localizedText(g.title, locale, g.key) : key;
  };
  const newButton = editable && (
    <Button asChild size="sm">
      <Link to={typesPath('new')}>
        <PlusIcon aria-hidden="true" />
        {t('contentTypes.new')}
      </Link>
    </Button>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('contentTypes.listTitle')}
        description={t('contentTypes.listDescription')}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link to={typesPath('groups')}>
                <FolderIcon aria-hidden="true" />
                {t('contentTypes.groupsLink')}
              </Link>
            </Button>
            {newButton}
          </>
        }
      />

      {!editable && (
        <Alert variant="warning">
          <AlertDescription>{t('builder.readOnly')}</AlertDescription>
        </Alert>
      )}

      {types.length === 0 ? (
        <EmptyState icon={WrenchIcon} title={t('contentTypes.empty')} action={newButton || undefined} />
      ) : (
        <Card className="py-0">
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('contentTypes.columns.name')}</TableHead>
                  <TableHead>{t('contentTypes.columns.apiId')}</TableHead>
                  <TableHead>{t('contentTypes.columns.group')}</TableHead>
                  <TableHead className="text-right">{t('contentTypes.columns.fields')}</TableHead>
                  <TableHead>{t('contentTypes.columns.private')}</TableHead>
                  <TableHead>{t('contentTypes.columns.review')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {types.map((ty) => (
                  <TableRow key={ty.id} className="cursor-pointer" onClick={() => navigate(typesPath(ty.apiId))}>
                    <TableCell>
                      <Link to={typesPath(ty.apiId)} className="font-medium underline-offset-4 hover:underline" onClick={(e) => e.stopPropagation()}>
                        {typeName(ty)}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{ty.apiId}</TableCell>
                    <TableCell>{groupTitle(ty.group) ?? <span className="text-muted-foreground">{t('builder.noGroup')}</span>}</TableCell>
                    <TableCell className="text-right">{ty.fields.length}</TableCell>
                    <TableCell>{ty.private ? <PrivateLock className="size-4" /> : <BoolMark value={false} label="" />}</TableCell>
                    <TableCell>
                      <BoolMark value={!!ty.review} label={t('contentTypes.columns.review')} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
