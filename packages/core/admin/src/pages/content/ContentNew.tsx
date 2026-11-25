import { ErrorAlert } from '../../components/ErrorAlert';
import { Badge } from '../../components/ui/badge';
import { t } from '../../i18n';
import { api } from '../../lib/api';
import { Redirect, useAdminNavigate, useAdminParams } from '../../lib/nav';
import { PageSkeleton } from './ContentDetail';
import { EntryForm } from './ContentEdit';
import { canCreateEntries, contentPath, typeTitle, useContentType, useEditorLocale, type Entry } from './useEntry';

/** `/content/:apiId/new`: field cards and Save, which lands on the new entry's detail page. */
export function ContentNew() {
  const { apiId = '' } = useAdminParams();
  return <NewView key={apiId} apiId={apiId} />;
}

function NewView({ apiId }: { apiId: string }) {
  const navigate = useAdminNavigate();
  const { def, meta, error } = useContentType(apiId);
  const [locale] = useEditorLocale(meta, def);

  if (error) return <ErrorAlert error={error} />;
  if (!def || !meta) return <PageSkeleton />;

  const listTo = contentPath(apiId, [], locale, meta.defaultLocale);
  if (!canCreateEntries(def)) {
    // A required readOnly field cannot be set here (admin create rejects readOnly values): back to the list.
    return <Redirect to={listTo} />;
  }

  return (
    <EntryForm
      def={def}
      meta={meta}
      locale={locale}
      entry={null}
      files={[]}
      title={t('content.newEntry')}
      crumbs={[{ label: typeTitle(def), to: listTo }, { label: t('content.newEntry') }]}
      cancelTo={listTo}
      actions={def.private ? undefined : <Badge variant="outline" className="font-mono">{locale}</Badge>}
      save={async (body) => {
        const json = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null));
        return (await api<{ data: Entry }>(`/api/admin/content/${apiId}?locale=${locale}`, { method: 'POST', json })).data;
      }}
      onSaved={(saved) => navigate(contentPath(apiId, [saved.documentId], locale, meta.defaultLocale), { replace: true })}
    />
  );
}
