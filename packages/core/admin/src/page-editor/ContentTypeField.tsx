import { useEffect, useState } from 'react';
import type { CustomFieldRender } from '@puckeditor/core';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { t } from '../i18n';
import { useLocale } from '../i18n/hooks';
import { FieldShell, fieldLabel } from './FieldShell';
import { contentTypeOptions } from './field-logic';
import { loadContentTypes } from './data';

const NONE = '__none__';

/** The text prop named by an entries field's `apiIdFrom`, offered as a content type select (stores the apiId). */
export const ContentTypeField: CustomFieldRender<string> = ({ field, name, id, value, onChange, readOnly }) => {
  const locale = useLocale();
  const [options, setOptions] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    let live = true;
    loadContentTypes()
      .then((types) => live && setOptions(contentTypeOptions(types, locale)))
      .catch(() => live && setOptions([]));
    return () => {
      live = false;
    };
  }, [locale]);
  const known = !value || options.some((o) => o.value === value);
  return (
    <FieldShell id={id} label={fieldLabel(field, name)}>
      <Select value={value || NONE} disabled={readOnly} onValueChange={(v) => onChange(v === NONE ? '' : v)}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={t('pageEditor.fields.contentType.placeholder')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t('pageEditor.fields.none')}</SelectItem>
          {!known && <SelectItem value={value}>{value}</SelectItem>}
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldShell>
  );
};
