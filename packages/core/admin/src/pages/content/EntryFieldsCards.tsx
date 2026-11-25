import type { UseFormReturn } from 'react-hook-form';
import { FieldInput, type EntryFile } from '../../components/FieldInput';
import { Badge } from '../../components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { FormDescription, FormField, FormItem, FormMessage, useFormField } from '../../components/ui/form';
import { Label } from '../../components/ui/label';
import { t } from '../../i18n';
import type { ContentTypeDefinition, FieldDefinition } from '../../lib/types';
import type { Values } from './useEntry';

const noop = () => undefined;

function FieldLabel({ id, field, locale }: { id: string; field: FieldDefinition; locale: string }) {
  return (
    <Label id={`${id}-label`} htmlFor={id}>
      {field.label ?? field.name}
      {field.required && !field.readOnly && (
        <>
          <span aria-hidden="true"> *</span>
          <span className="sr-only"> {t('field.required')}</span>
        </>
      )}
      {field.localizable && <Badge variant="outline">{locale}</Badge>}
    </Label>
  );
}

function FieldHelp({ field }: { field: FieldDefinition }) {
  const text = helpText(field);
  return text ? <p className="text-sm text-muted-foreground">{text}</p> : null;
}

const helpText = (field: FieldDefinition) => (field.readOnly ? t('content.readOnlyHint') : field.description);

/** Inside a FormItem: the widget gets `aria-invalid` and `aria-describedby` (help and error message ids). */
function FormFieldBody({
  id,
  field,
  value,
  onChange,
  disabled,
  privateAssets,
}: {
  id: string;
  field: FieldDefinition;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled: boolean;
  privateAssets?: { apiId: string; files: EntryFile[] };
}) {
  const { error, formDescriptionId, formMessageId } = useFormField();
  const help = helpText(field);
  const describedBy = [help ? formDescriptionId : '', error ? formMessageId : ''].filter(Boolean).join(' ');
  return (
    <>
      <FieldInput
        id={id}
        field={field}
        value={value ?? null}
        onChange={onChange}
        disabled={disabled}
        privateAssets={privateAssets}
        invalid={!!error}
        describedBy={describedBy}
      />
      {help && <FormDescription>{help}</FormDescription>}
      <FormMessage />
    </>
  );
}

interface Props {
  def: ContentTypeDefinition;
  locale: string;
  /** Private entry files (filename, size) for asset fields. */
  files: EntryFile[];
}

/**
 * The entry's fields as cards (one "Fields" card: content types define no field sections). Pass `form` to edit;
 * without it the values are shown read-only. readOnly fields are always disabled.
 */
export function EntryFieldsCards({
  def,
  locale,
  files,
  form,
  values,
  locked = false,
}: Props & { form?: UseFormReturn<Values>; values?: Values; locked?: boolean }) {
  const privateAssets = def.private ? { apiId: def.apiId, files } : undefined;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('content.fieldsCard')}</CardTitle>
        <CardDescription>{t('content.fieldsDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        {def.fields.map((f) => {
          const id = `field-${f.id}`;
          if (!form) {
            return (
              <div key={f.id} className="grid gap-2">
                <FieldLabel id={id} field={f} locale={locale} />
                <FieldInput id={id} field={f} value={values?.[f.name] ?? null} onChange={noop} disabled privateAssets={privateAssets} />
                <FieldHelp field={f} />
              </div>
            );
          }
          return (
            <FormField
              key={f.id}
              control={form.control}
              name={f.name}
              render={({ field }) => (
                <FormItem>
                  <FieldLabel id={id} field={f} locale={locale} />
                  <FormFieldBody
                    id={id}
                    field={f}
                    value={field.value}
                    onChange={(v) => field.onChange(v)}
                    disabled={locked || !!f.readOnly}
                    privateAssets={privateAssets}
                  />
                </FormItem>
              )}
            />
          );
        })}
      </CardContent>
    </Card>
  );
}
