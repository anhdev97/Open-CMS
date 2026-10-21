import { BoxesIcon, PlusIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { ErrorAlert } from '../components/ErrorAlert';
import { PageHeader } from '../components/PageHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Link } from '../lib/nav';
import { localizedText } from '@opencms/schema';
import { getActiveLocale, t } from '../i18n';
import { api } from '../lib/api';
import type { ApiError } from '../lib/api-error';
import type { ContentTypeDefinition, Meta } from '../lib/types';

export function Home() {
  const [types, setTypes] = useState<ContentTypeDefinition[] | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);

  useEffect(() => {
    api<{ data: ContentTypeDefinition[] }>('/api/admin/content-types')
      .then((r) => setTypes(r.data))
      .catch(setError);
    api<Meta>('/api/admin/meta').then(setMeta).catch(setError);
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('home.title')}
        description={t('home.description')}
        actions={
          <Button asChild>
            <Link to="/settings/content-types">
              <PlusIcon aria-hidden="true" />
              {t('home.newType')}
            </Link>
          </Button>
        }
      />

      {meta && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{t('home.locales', { locales: meta.locales.join(', '), default: meta.defaultLocale })}</span>
          <span aria-hidden="true">·</span>
          <span>{t('home.schemaEditing')}</span>
          {meta.schemaEditable ? (
            <Badge variant="success">{t('home.schemaEnabled')}</Badge>
          ) : (
            <Badge variant="warning">{t('home.schemaReadOnly')}</Badge>
          )}
        </p>
      )}

      <ErrorAlert error={error} />

      {types === null && !error && (
        <div className="space-y-2" aria-hidden="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}

      {types?.length === 0 && (
        <EmptyState
          icon={BoxesIcon}
          title={t('home.emptyTitle')}
          description={t('home.emptyDescription')}
          action={
            <Button asChild>
              <Link to="/settings/content-types">{t('home.newType')}</Link>
            </Button>
          }
        />
      )}

      {types && types.length > 0 && (
        <Card className="py-0">
          <CardContent className="px-0">
            <Table aria-label={t('home.listLabel')}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('home.name')}</TableHead>
                  <TableHead>{t('home.apiId')}</TableHead>
                  <TableHead>{t('home.fields')}</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">{t('home.editSchema')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {types.map((type) => (
                  <TableRow key={type.id}>
                    <TableCell className="font-medium">
                      <Button asChild variant="link" className="h-auto p-0 font-medium">
                        <Link to={`/content/${type.apiId}`}>{localizedText(type.displayName, getActiveLocale(), type.apiId)}</Link>
                      </Button>
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground">{type.apiId}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {type.fields.map((f) => (
                          <Badge key={f.id} variant="secondary">
                            {f.name}: {f.kind}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="ghost" size="sm">
                        <Link to={`/settings/content-types?type=${type.apiId}`}>{t('home.editSchema')}</Link>
                      </Button>
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
