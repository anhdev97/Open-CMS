import { zodResolver } from '@hookform/resolvers/zod';
import { isReservedApiId, localizedText, SUPPORTED_LOCALES } from '@opencloudcms/schema';
import { PlusIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Breadcrumbs, type Crumb } from '../../components/Breadcrumbs';
import { ErrorAlert } from '../../components/ErrorAlert';
import { PageHeader } from '../../components/PageHeader';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Switch } from '../../components/ui/switch';
import { getActiveLocale, t } from '../../i18n';
import { api } from '../../lib/api';
import { ApiError } from '../../lib/api-error';
import { fromLocalizedText, toLocalizedText } from '../../lib/content-groups';
import { Link, Redirect, useAdminNavigate, useAdminParams } from '../../lib/nav';
import type { ApplyResponse, ContentTypeDefinition, FieldDefinition, Meta, PlanResponse } from '../../lib/types';
import { useUnsavedChangesGuard } from '../content/useEntry';
import { FieldSheet } from './FieldSheet';
import { FieldsTable, moveItem } from './FieldsTable';
import {
  announceSchemaChange,
  API_ID_RE,
  emptyField,
  NONE,
  rememberSaveResult,
  typeName,
  typesPath,
  TypesSkeleton,
  useEntryCount,
  type EntryCount,
  useSchemaTypes,
} from './shared';

export interface InfoValues {
  apiId: string;
  names: Record<string, string>;
  group: string;
  description: string;
  review: boolean;
  private: boolean;
}

export function infoValues(def: ContentTypeDefinition): InfoValues {
  const names = fromLocalizedText(def.displayName);
  return {
    apiId: def.apiId,
    names: Object.fromEntries(SUPPORTED_LOCALES.map((l) => [l.code, names[l.code] ?? ''])),
    group: def.group ?? NONE,
    description: def.description ?? '',
    review: !!def.review,
    private: !!def.private,
  };
}

/**
 * The definition the schema builder receives (same shape as the single-page Builder sent): the stored definition
 * with the form's values applied. Untouched values keep their stored form; optional flags are only present when on.
 */
export function buildDefinition(base: ContentTypeDefinition, values: InfoValues, fields: FieldDefinition[]): ContentTypeDefinition {
  const { group: _group, description: _description, review: _review, private: _private, ...rest } = base;
  const initial = infoValues(base);
  const sameNames = SUPPORTED_LOCALES.every((l) => (values.names[l.code] ?? '') === (initial.names[l.code] ?? ''));
  const def: ContentTypeDefinition = {
    ...rest,
    apiId: values.apiId.trim(),
    displayName: sameNames ? base.displayName : toLocalizedText(values.names),
    fields,
  };
  if (values.group !== NONE) def.group = values.group;
  const description = values.description === initial.description ? base.description : values.description.trim() || undefined;
  if (description !== undefined) def.description = description;
  if (values.private) def.private = true;
  else if (values.review) def.review = true;
  return def;
}

/** JSON with sorted object keys, for comparing definitions regardless of key order. */
export function stableJson(v: unknown): string {
  return JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x,
  );
}

/** apiIds the admin routes use as sub-pages (`/settings/content-types/new`, `/groups`). */
const ROUTE_API_IDS = ['new', 'groups'];

function infoSchema(base: ContentTypeDefinition, types: ContentTypeDefinition[]) {
  return z
    .object({
      apiId: z.string(),
      names: z.record(z.string()),
      group: z.string(),
      description: z.string(),
      review: z.boolean(),
      private: z.boolean(),
    })
    .superRefine((v, ctx) => {
      const apiId = v.apiId.trim();
      const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['apiId'], message });
      if (!API_ID_RE.test(apiId)) issue(t('contentTypes.apiIdInvalid'));
      else if (isReservedApiId(apiId) || ROUTE_API_IDS.includes(apiId)) issue(t('contentTypes.apiIdReserved', { apiId }));
      else if (types.some((ty) => ty.id !== base.id && ty.apiId === apiId)) issue(t('contentTypes.apiIdTaken'));
      if (!(v.names['en-US'] ?? '').trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['names', 'en-US'], message: t('contentTypes.nameRequired') });
    });
}

function SwitchRow({ id, label, hint, checked, disabled, onChange }: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} aria-describedby={`${id}-hint`} />
      <div className="space-y-0.5">
        <Label htmlFor={id} className="font-normal">
          {label}
        </Label>
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      </div>
    </div>
  );
}

const ErrorText = ({ id, message }: { id: string; message?: string }) =>
  message ? (
    <p id={id} className="text-sm text-destructive">
      {message}
    </p>
  ) : null;

interface TypeFormProps {
  /** The stored type; `null` creates one. */
  original: ContentTypeDefinition | null;
  base: ContentTypeDefinition;
  types: ContentTypeDefinition[];
  meta: Meta;
  /** Entries of the stored type (private lock); `null` for a new type. */
  entries: EntryCount | null;
  crumbs: Crumb[];
  title: string;
  cancelTo: string;
}

/** Shared by new and edit: info Card (react-hook-form + zod), Fields Card with the Sheet, sticky Save bar, guard. */
export function TypeForm({ original, base, types, meta, entries, crumbs, title, cancelTo }: TypeFormProps) {
  const navigate = useAdminNavigate();
  const isNew = original === null;
  const schema = useMemo(() => infoSchema(base, types), [base, types]);
  const form = useForm<InfoValues>({ resolver: zodResolver(schema), defaultValues: infoValues(base) });
  const [fields, setFields] = useState<FieldDefinition[]>(() => structuredClone(base.fields));
  const [sheet, setSheet] = useState<{ index: number | null; field: FieldDefinition } | null>(null);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [formError, setFormError] = useState<Error | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const values = form.watch();
  const definition = buildDefinition(base, values, fields);
  const dirty = isNew ? form.formState.isDirty || fields.length > 0 : stableJson(definition) !== stableJson(original);
  const release = useUnsavedChangesGuard(dirty);
  const submitting = form.formState.isSubmitting;
  const errors = form.formState.errors;
  const isPrivate = values.private;
  const renamed = !isNew && values.apiId.trim() !== original!.apiId;
  // Switching private needs an empty type: locked while the count loads and when entries exist.
  const privateLocked = !isNew && (entries?.state === 'loading' || (entries?.state === 'ok' && entries.count > 0));
  const privateHint = isNew
    ? t('contentTypes.privateHint')
    : entries?.state === 'ok' && entries.count > 0
      ? t('contentTypes.privateLocked', { count: entries.count })
      : entries?.state === 'loading'
        ? t('contentTypes.privateCounting')
        : entries?.state === 'error'
          ? t('contentTypes.privateCountFailed')
          : t('contentTypes.privateHint');
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (formError) errorRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }, [formError]);
  const table = `ct_${values.apiId.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase() || '…'}`;

  const changeFields = (next: FieldDefinition[]) => {
    setFields(next);
    setPlan(null);
  };
  const setPrivate = (on: boolean) => {
    form.setValue('private', on, { shouldDirty: true });
    if (on) {
      form.setValue('review', false, { shouldDirty: true });
      if (fields.some((f) => f.localizable)) changeFields(fields.map((f) => (f.localizable ? { ...f, localizable: false } : f)));
    }
    setPlan(null);
  };

  async function onSubmit(v: InfoValues) {
    setFormError(null);
    const def = buildDefinition(base, v, fields);
    try {
      const r = await api<ApplyResponse>('/api/admin/content-types', { method: 'POST', json: { definition: def } });
      announceSchemaChange();
      toast.success(t('builder.savedToast'));
      rememberSaveResult(def.apiId, r);
      release();
      navigate(typesPath(def.apiId), { replace: true, skipGuard: true });
    } catch (e) {
      setFormError(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async function preview() {
    setFormError(null);
    setPreviewing(true);
    try {
      setPlan(await api<PlanResponse>('/api/admin/content-types/plan', { method: 'POST', json: { definition } }));
    } catch (e) {
      setFormError(e instanceof ApiError || e instanceof Error ? e : new Error(String(e)));
    } finally {
      setPreviewing(false);
    }
  }

  const groups = meta.groups ?? [];
  return (
    <form className="space-y-6" onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <Breadcrumbs items={crumbs} />
      <PageHeader title={title} />
      <div ref={errorRef}>
        <ErrorAlert error={formError} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('contentTypes.infoCard')}</CardTitle>
          <CardDescription>{t('contentTypes.infoCardDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="type-api-id">{t('builder.apiId')}</Label>
              <Input
                id="type-api-id"
                placeholder={t('builder.apiIdPlaceholder')}
                aria-invalid={errors.apiId ? true : undefined}
                aria-describedby={errors.apiId ? 'type-api-id-error' : renamed ? 'type-api-id-hint' : undefined}
                {...form.register('apiId')}
              />
              <ErrorText id="type-api-id-error" message={errors.apiId?.message} />
              {renamed && (
                <p id="type-api-id-hint" className="text-xs text-warning">
                  {t('contentTypes.renameWarning')}
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="type-group">{t('builder.group')}</Label>
              <Select value={values.group} onValueChange={(v) => form.setValue('group', v, { shouldDirty: true })}>
                <SelectTrigger id="type-group" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('builder.noGroup')}</SelectItem>
                  {groups.map((g) => (
                    <SelectItem key={g.key} value={g.key}>
                      {localizedText(g.title, getActiveLocale(), g.key)}
                    </SelectItem>
                  ))}
                  {values.group !== NONE && !groups.some((g) => g.key === values.group) && <SelectItem value={values.group}>{values.group}</SelectItem>}
                </SelectContent>
              </Select>
            </div>
          </div>

          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">{t('builder.displayName')}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {SUPPORTED_LOCALES.map((l) => {
                const err = l.code === 'en-US' ? errors.names?.['en-US']?.message : undefined;
                return (
                  <div key={l.code} className="grid gap-1">
                    <Label htmlFor={`type-display-name-${l.code}`} className="font-normal text-muted-foreground">
                      {l.name}
                      {l.code === 'en-US' && ` · ${t('builder.requiredShort')}`}
                    </Label>
                    <Input
                      id={`type-display-name-${l.code}`}
                      aria-required={l.code === 'en-US'}
                      aria-invalid={err ? true : undefined}
                      aria-describedby={err ? 'type-display-name-error' : undefined}
                      placeholder={l.code === 'en-US' ? t('builder.displayNamePlaceholder') : ''}
                      {...form.register(`names.${l.code}`)}
                    />
                    {l.code === 'en-US' && <ErrorText id="type-display-name-error" message={err} />}
                  </div>
                );
              })}
            </div>
          </fieldset>

          <div className="grid gap-2">
            <Label htmlFor="type-description">{t('contentTypes.description')}</Label>
            <Input id="type-description" placeholder={t('contentTypes.descriptionPlaceholder')} {...form.register('description')} />
          </div>

          <div className="grid gap-4">
            <SwitchRow
              id="type-private"
              label={t('contentTypes.private')}
              hint={privateHint}
              checked={isPrivate}
              disabled={privateLocked}
              onChange={setPrivate}
            />
            <SwitchRow
              id="type-review"
              label={t('builder.review')}
              hint={isPrivate ? t('contentTypes.privateNoReview') : t('builder.reviewHint')}
              checked={values.review && !isPrivate}
              disabled={isPrivate}
              onChange={(on) => form.setValue('review', on, { shouldDirty: true })}
            />
          </div>

          <p className="font-mono text-xs text-muted-foreground">{t('builder.idLine', { id: base.id, table })}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('contentTypes.fieldsCard')}</CardTitle>
          <CardDescription>{t('contentTypes.fieldsCardEditDescription')}</CardDescription>
          <CardAction>
            <Button type="button" variant="outline" size="sm" onClick={() => setSheet({ index: null, field: emptyField() })}>
              <PlusIcon aria-hidden="true" />
              {t('builder.addField')}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="px-0">
          {fields.length === 0 ? (
            <p className="px-6 text-sm text-muted-foreground">{t('contentTypes.noFields')}</p>
          ) : (
            <FieldsTable
              fields={fields}
              persisted={original?.fields}
              onMove={(from, to) => changeFields(moveItem(fields, from, to))}
              onEdit={(i) => setSheet({ index: i, field: fields[i]! })}
              onRemove={(i) => changeFields(fields.filter((_, j) => j !== i))}
            />
          )}
        </CardContent>
      </Card>

      {plan && (
        <Card>
          <CardHeader>
            <CardTitle>{t('builder.previewTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!plan.changed && <p className="text-sm text-muted-foreground">{t('builder.noChanges')}</p>}
            {plan.changed && plan.sql.length === 0 && <p className="text-sm text-muted-foreground">{t('builder.metadataOnly')}</p>}
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {plan.summary.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
            {plan.warnings.map((w) => (
              <Alert key={w} variant="warning">
                <AlertDescription>{w}</AlertDescription>
              </Alert>
            ))}
            {plan.sql.length > 0 && <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">{plan.sql.map((s) => `${s};`).join('\n')}</pre>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('builder.whatHappens')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>{t('builder.steps.schema', { path: `src/content-types/${values.apiId || t('builder.schemaPathApiId')}/…schema.ts` })}</li>
            <li>{t('builder.steps.migration')}</li>
            <li>{t('builder.steps.generated')}</li>
            <li>{t('builder.steps.apply')}</li>
          </ol>
        </CardContent>
      </Card>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
        {dirty && (
          <p className="mr-auto text-sm text-muted-foreground" role="status">
            {t('content.unsavedBar')}
          </p>
        )}
        <Button asChild variant="outline">
          <Link to={cancelTo}>{t('common.cancel')}</Link>
        </Button>
        <Button type="button" variant="outline" disabled={previewing || submitting} onClick={preview}>
          {t('builder.preview')}
        </Button>
        <Button type="submit" disabled={submitting || !dirty}>
          {submitting ? t('builder.working') : t('builder.save')}
        </Button>
      </div>

      <FieldSheet
        field={sheet?.field ?? null}
        isNew={sheet?.index === null}
        siblings={sheet ? fields.filter((_, j) => j !== sheet.index) : fields}
        types={
          // This type may reference itself; its `private` follows the form (a new type is not in the list yet).
          types.some((ty) => ty.id === base.id)
            ? types.map((ty) => (ty.id === base.id ? { ...ty, private: isPrivate } : ty))
            : [...types, { ...base, apiId: values.apiId.trim(), private: isPrivate }].filter((ty) => ty.apiId)
        }
        kinds={meta.fieldKinds}
        privateType={isPrivate}
        onClose={() => setSheet(null)}
        onApply={(f) => {
          if (!sheet) return;
          changeFields(sheet.index === null ? [...fields, f] : fields.map((x, j) => (j === sheet.index ? f : x)));
          setSheet(null);
        }}
      />
    </form>
  );
}

/** `/settings/content-types/:apiId/edit`; production redirects to the detail page. */
export function TypeEdit() {
  const { apiId = '' } = useAdminParams();
  const { meta, types, error } = useSchemaTypes();
  const original = types?.find((ty) => ty.apiId === apiId) ?? null;
  const entries = useEntryCount(original ? apiId : null);
  if (error) return <ErrorAlert error={error} />;
  if (!meta || !types) return <TypesSkeleton />;
  if (!meta.schemaEditable) return <Redirect to={typesPath(apiId)} />;
  if (!original) return <ErrorAlert error={new Error(t('contentTypes.notFound', { apiId }))} />;
  const detailTo = typesPath(apiId);
  return (
    <TypeForm
      key={original.id}
      original={original}
      base={original}
      types={types}
      meta={meta}
      entries={entries}
      title={t('contentTypes.editTitle')}
      crumbs={[{ label: t('contentTypes.listTitle'), to: typesPath() }, { label: typeName(original), to: detailTo }, { label: t('contentTypes.edit') }]}
      cancelTo={detailTo}
    />
  );
}
