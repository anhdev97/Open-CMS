import { useState } from 'react';
import { ErrorAlert } from '../../components/ErrorAlert';
import { t } from '../../i18n';
import { Redirect } from '../../lib/nav';
import { TypeForm } from './TypeEdit';
import { emptyType, typesPath, TypesSkeleton, useSchemaTypes } from './shared';

/** `/settings/content-types/new`: create a type; Save lands on its detail page. Production redirects to the list. */
export function TypeNew() {
  const { meta, types, error } = useSchemaTypes();
  const [base] = useState(emptyType);
  if (error) return <ErrorAlert error={error} />;
  if (!meta || !types) return <TypesSkeleton />;
  if (!meta.schemaEditable) return <Redirect to={typesPath()} />;
  return (
    <TypeForm
      original={null}
      base={base}
      types={types}
      meta={meta}
      entries={null}
      title={t('contentTypes.newTitle')}
      crumbs={[{ label: t('contentTypes.listTitle'), to: typesPath() }, { label: t('contentTypes.newTitle') }]}
      cancelTo={typesPath()}
    />
  );
}
