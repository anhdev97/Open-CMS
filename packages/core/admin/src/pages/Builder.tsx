import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorAlert } from '../components/ErrorAlert';
import { PageHeader } from '../components/PageHeader';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Checkbox } from '../components/ui/checkbox';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { useAdminNavigate, useAdminSearch } from '../lib/nav';
import { t } from '../i18n/en';
import { api } from '../lib/api';
import { ApiError } from '../lib/api-error';
import {
  newId,
  type ApplyResponse,
  type ContentTypeDefinition,
  type FieldDefinition,
  type FieldKind,
  type Meta,
  type PlanResponse,
} from '../lib/types';

const NONE = '__none__';
const ALL_KINDS: FieldKind[] = [
  'text', 'longText', 'richText', 'slug', 'email', 'url', 'number', 'boolean',
  'date', 'datetime', 'json', 'money', 'asset', 'reference', 'taxonomy',
];

const emptyType = (): ContentTypeDefinition => ({ id: newId('ct'), apiId: '', displayName: '', fields: [] });
const emptyField = (): FieldDefinition => ({
  id: newId('fld'), name: '', kind: 'text', required: false, localizable: false, indexed: false, unique: false, options: {},
});

function CheckField({ id, label, checked, disabled, onChange }: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={(c) => onChange(c === true)} />
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
    </div>
  );
}

function OptionSelect({ id, label, value, onChange, children }: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full min-w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </div>
  );
}

function FieldOptions({ field, types, fields, onChange }: {
  field: FieldDefinition;
  types: ContentTypeDefinition[];
  fields: FieldDefinition[];
  onChange: (options: Record<string, any>) => void;
}) {
  const o = field.options;
  const set = (patch: Record<string, any>) => onChange({ ...o, ...patch });
  const id = (name: string) => `${field.id}-opt-${name}`;
  switch (field.kind) {
    case 'text':
    case 'slug':
      return (
        <>
          <div className="space-y-2">
            <Label htmlFor={id('maxLength')}>{t('builder.options.maxLength')}</Label>
            <Input
              id={id('maxLength')}
              type="number"
              className="w-28"
              value={o.maxLength ?? 255}
              onChange={(e) => set({ maxLength: Number(e.target.value) })}
            />
          </div>
          {field.kind === 'slug' && (
            <OptionSelect
              id={id('from')}
              label={t('builder.options.generatedFrom')}
              value={o.from ?? NONE}
              onChange={(v) => set({ from: v === NONE ? undefined : v })}
            >
              <SelectItem value={NONE}>{t('content.noValue')}</SelectItem>
              {fields.filter((f) => f.kind === 'text' && f.name).map((f) => (
                <SelectItem key={f.id} value={f.name}>
                  {f.name}
                </SelectItem>
              ))}
            </OptionSelect>
          )}
        </>
      );
    case 'number':
      return (
        <OptionSelect id={id('format')} label={t('builder.options.format')} value={o.format ?? 'integer'} onChange={(v) => set({ format: v })}>
          <SelectItem value="integer">{t('builder.options.integer')}</SelectItem>
          <SelectItem value="decimal">{t('builder.options.decimal')}</SelectItem>
        </OptionSelect>
      );
    case 'money':
      return (
        <>
          <OptionSelect
            id={id('currencyMode')}
            label={t('builder.options.currency')}
            value={o.currencyMode ?? 'market'}
            onChange={(v) => set({ currencyMode: v })}
          >
            <SelectItem value="market">{t('builder.options.fromMarket')}</SelectItem>
            <SelectItem value="fixed">{t('builder.options.fixed')}</SelectItem>
          </OptionSelect>
          {o.currencyMode === 'fixed' && (
            <div className="space-y-2">
              <Label htmlFor={id('currency')}>{t('builder.options.isoCode')}</Label>
              <Input
                id={id('currency')}
                className="w-24"
                value={o.currency ?? ''}
                maxLength={3}
                onChange={(e) => set({ currency: e.target.value.toUpperCase() })}
              />
            </div>
          )}
        </>
      );
    case 'reference':
      return (
        <>
          <OptionSelect id={id('target')} label={t('builder.options.targetType')} value={o.target || NONE} onChange={(v) => set({ target: v === NONE ? '' : v })}>
            <SelectItem value={NONE}>{t('builder.options.selectType')}</SelectItem>
            {types.map((type) => (
              <SelectItem key={type.id} value={type.apiId}>
                {type.displayName}
              </SelectItem>
            ))}
          </OptionSelect>
          <CheckField id={id('multiple')} label={t('builder.options.multiple')} checked={!!o.multiple} onChange={(c) => set({ multiple: c })} />
        </>
      );
    case 'taxonomy':
      return (
        <>
          <div className="space-y-2">
            <Label htmlFor={id('taxonomy')}>{t('builder.options.taxonomySlug')}</Label>
            <Input
              id={id('taxonomy')}
              value={o.taxonomy ?? ''}
              onChange={(e) => set({ taxonomy: e.target.value })}
              placeholder={t('builder.options.taxonomyPlaceholder')}
            />
          </div>
          <CheckField id={id('multiple')} label={t('builder.options.multiple')} checked={!!o.multiple} onChange={(c) => set({ multiple: c })} />
        </>
      );
    case 'asset':
      return <CheckField id={id('multiple')} label={t('builder.options.multiple')} checked={!!o.multiple} onChange={(c) => set({ multiple: c })} />;
    default:
      return null;
  }
}

export function Builder() {
  const navigate = useAdminNavigate();
  const params = new URLSearchParams(useAdminSearch());
  const selected = params.get('type');
  const [meta, setMeta] = useState<Meta | null>(null);
  const [types, setTypes] = useState<ContentTypeDefinition[]>([]);
  const [draft, setDraft] = useState<ContentTypeDefinition>(emptyType);
  const [original, setOriginal] = useState<ContentTypeDefinition | null>(null);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [result, setResult] = useState<ApplyResponse | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  // After a successful save the URL catches up with the saved type; that navigation must not wipe the result panel.
  const savedApiId = useRef<string | null>(null);

  const load = async () => {
    const [m, list] = await Promise.all([
      api<Meta>('/api/admin/meta'),
      api<{ data: ContentTypeDefinition[] }>('/api/admin/content-types'),
    ]);
    setMeta(m);
    setTypes(list.data);
    return list.data;
  };

  useEffect(() => {
    const keepResult = selected !== null && savedApiId.current === selected;
    savedApiId.current = null;
    load()
      .then((all) => {
        if (keepResult) return;
        const existing = all.find((type) => type.apiId === selected) ?? null;
        setOriginal(existing);
        setDraft(existing ? structuredClone(existing) : emptyType());
        setPlan(null);
        setResult(null);
        setError(null);
      })
      .catch(setError);
  }, [selected]);

  const isNew = !original;
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(original), [draft, original]);

  const updateField = (i: number, patch: Partial<FieldDefinition>) => {
    setDraft((d) => ({ ...d, fields: d.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) }));
    setPlan(null);
  };
  const moveField = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      const fields = [...d.fields];
      const j = i + dir;
      if (j < 0 || j >= fields.length) return d;
      [fields[i], fields[j]] = [fields[j], fields[i]];
      return { ...d, fields };
    });

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e : e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBusy(false);
    }
  };

  const preview = () =>
    run(async () => {
      setResult(null);
      setPlan(await api<PlanResponse>('/api/admin/content-types/plan', { method: 'POST', json: { definition: draft } }));
    });

  const save = () =>
    run(async () => {
      const r = await api<ApplyResponse>('/api/admin/content-types', { method: 'POST', json: { definition: draft } });
      setResult(r);
      setPlan(null);
      await load();
      setOriginal(structuredClone(draft));
      window.dispatchEvent(new Event('opencms:schema-changed'));
      toast.success(t('builder.savedToast'));
      if (selected !== draft.apiId) {
        savedApiId.current = draft.apiId;
        navigate(`/builder?type=${draft.apiId}`, { replace: true });
      }
    });

  const remove = () =>
    run(async () => {
      if (!original) return;
      const r = await api<ApplyResponse>(`/api/admin/content-types/${original.id}`, { method: 'DELETE' });
      setResult(r);
      window.dispatchEvent(new Event('opencms:schema-changed'));
      toast.success(t('builder.archivedToast'));
      navigate('/builder', { replace: true });
    });

  const editable = meta?.schemaEditable ?? false;
  const table = `ct_${draft.apiId.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase() || '…'}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('builder.title')}
        description={t('builder.description')}
        actions={
          <Select value={selected ?? NONE} onValueChange={(v) => navigate(v === NONE ? '/builder' : `/builder?type=${v}`)}>
            <SelectTrigger size="sm" aria-label={t('builder.pickType')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('builder.newTypeOption')}</SelectItem>
              {types.map((type) => (
                <SelectItem key={type.id} value={type.apiId}>
                  {type.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {meta && !editable && (
        <Alert variant="warning">
          <AlertDescription>{t('builder.readOnly')}</AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardContent className="space-y-3">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="type-display-name">{t('builder.displayName')}</Label>
                  <Input
                    id="type-display-name"
                    value={draft.displayName}
                    onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
                    placeholder={t('builder.displayNamePlaceholder')}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="type-api-id">{t('builder.apiId')}</Label>
                  <Input
                    id="type-api-id"
                    value={draft.apiId}
                    onChange={(e) => setDraft({ ...draft, apiId: e.target.value })}
                    placeholder={t('builder.apiIdPlaceholder')}
                  />
                </div>
              </div>
              <p className="font-mono text-xs text-muted-foreground">
                {t('builder.idLine', { id: draft.id, table })}
                {!isNew && original!.apiId !== draft.apiId && ` · ${t('builder.renameWarning')}`}
              </p>
            </CardContent>
          </Card>

          {draft.fields.map((field, i) => {
            const multiple = !!field.options.multiple && ['asset', 'reference', 'taxonomy'].includes(field.kind);
            const persisted = original?.fields.find((f) => f.id === field.id);
            const fid = (name: string) => `${field.id}-${name}`;
            return (
              <Card key={field.id}>
                <CardHeader className="flex-row items-center justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle>{field.name || t('builder.newField')}</CardTitle>
                    <p className="font-mono text-xs text-muted-foreground">
                      {field.id}
                      {persisted && persisted.name !== field.name && ` · ${t('builder.renameField', { from: persisted.name, to: field.name })}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="icon-sm" aria-label={t('builder.moveUp', { name: field.name || t('builder.newField') })} disabled={i === 0} onClick={() => moveField(i, -1)}>
                      <ArrowUpIcon aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('builder.moveDown', { name: field.name || t('builder.newField') })}
                      disabled={i === draft.fields.length - 1}
                      onClick={() => moveField(i, 1)}
                    >
                      <ArrowDownIcon aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('builder.removeField', { name: field.name || t('builder.newField') })}
                      onClick={() => setDraft({ ...draft, fields: draft.fields.filter((_, j) => j !== i) })}
                    >
                      <Trash2Icon aria-hidden="true" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap items-end gap-4">
                    <div className="space-y-2">
                      <Label htmlFor={fid('name')}>{t('builder.fieldName')}</Label>
                      <Input
                        id={fid('name')}
                        value={field.name}
                        onChange={(e) => updateField(i, { name: e.target.value })}
                        placeholder={t('builder.fieldNamePlaceholder')}
                      />
                    </div>
                    <OptionSelect
                      id={fid('kind')}
                      label={t('builder.fieldKind')}
                      value={field.kind}
                      onChange={(v) => updateField(i, { kind: v as FieldKind, options: {} })}
                    >
                      {(meta?.fieldKinds ?? ALL_KINDS).map((k) => (
                        <SelectItem key={k} value={k}>
                          {t(`builder.kinds.${k}`)}
                        </SelectItem>
                      ))}
                    </OptionSelect>
                    <div className="min-w-40 flex-1 space-y-2">
                      <Label htmlFor={fid('label')}>{t('builder.fieldLabel')}</Label>
                      <Input id={fid('label')} value={field.label ?? ''} onChange={(e) => updateField(i, { label: e.target.value || undefined })} />
                    </div>
                    <FieldOptions field={field} types={types} fields={draft.fields} onChange={(options) => updateField(i, { options })} />
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-2">
                    <CheckField id={fid('required')} label={t('builder.required')} checked={field.required} onChange={(c) => updateField(i, { required: c })} />
                    <CheckField
                      id={fid('localizable')}
                      label={t('builder.localizable')}
                      checked={field.localizable}
                      disabled={multiple}
                      onChange={(c) => updateField(i, { localizable: c })}
                    />
                    <CheckField
                      id={fid('indexed')}
                      label={t('builder.indexed')}
                      checked={field.indexed || field.unique}
                      disabled={multiple || field.unique}
                      onChange={(c) => updateField(i, { indexed: c })}
                    />
                    <CheckField
                      id={fid('unique')}
                      label={t('builder.unique')}
                      checked={field.unique}
                      disabled={multiple}
                      onChange={(c) => updateField(i, { unique: c, indexed: c || field.indexed })}
                    />
                  </div>
                </CardContent>
              </Card>
            );
          })}

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setDraft({ ...draft, fields: [...draft.fields, emptyField()] })}>
              <PlusIcon aria-hidden="true" />
              {t('builder.addField')}
            </Button>
            <span className="grow" />
            {!isNew && (
              <Button variant="destructive" disabled={!editable || busy} onClick={() => setConfirmArchive(true)}>
                {t('builder.archive')}
              </Button>
            )}
            <Button variant="outline" disabled={busy} onClick={preview}>
              {t('builder.preview')}
            </Button>
            <Button disabled={!editable || busy || !dirty} onClick={save}>
              {busy ? t('builder.working') : t('builder.save')}
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('builder.whatHappens')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                <li>
                  {t('builder.steps.schema', {
                    path: `src/content-types/${draft.apiId || t('builder.schemaPathApiId')}/…schema.ts`,
                  })}
                </li>
                <li>{t('builder.steps.migration')}</li>
                <li>{t('builder.steps.generated')}</li>
                <li>{t('builder.steps.apply')}</li>
              </ol>
            </CardContent>
          </Card>

          <ErrorAlert error={error} />

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
                {plan.sql.length > 0 && (
                  <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">{plan.sql.map((s) => `${s};`).join('\n')}</pre>
                )}
              </CardContent>
            </Card>
          )}

          {result && (
            <Card>
              <CardContent className="space-y-3">
                <Alert variant="success">
                  <AlertDescription>
                    {result.status === 'created'
                      ? t('builder.resultCreated')
                      : result.status === 'metadata-only'
                        ? t('builder.resultMetadata')
                        : t('builder.resultNothing')}
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
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title={t('builder.archiveTitle', { name: original?.displayName ?? '' })}
        description={t('builder.archiveDescription')}
        confirmLabel={t('builder.archiveConfirm')}
        destructive
        onConfirm={remove}
      />
    </div>
  );
}
