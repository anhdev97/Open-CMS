import { useEffect, useState, type ReactNode } from 'react';
import { z } from 'zod';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '../../components/ui/sheet';
import { t } from '../../i18n';
import type { ContentTypeDefinition, FieldDefinition, FieldKind } from '../../lib/types';
import { ALL_KINDS, FIELD_NAME_RE, NONE, RESERVED_FIELD_NAMES, typeName } from './shared';

/** Types a reference field may target: a public type cannot reference private types (the server rejects it). */
export function referenceTargets(types: ContentTypeDefinition[], privateType: boolean): ContentTypeDefinition[] {
  return privateType ? types : types.filter((ty) => !ty.private);
}

const MULTI_KINDS: FieldKind[] = ['asset', 'reference', 'taxonomy'];
const isMultiple = (f: FieldDefinition) => !!f.options.multiple && MULTI_KINDS.includes(f.kind);

function CheckField({ id, label, hint, checked, disabled, onChange }: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <Checkbox id={id} checked={checked} disabled={disabled} aria-describedby={hint ? `${id}-hint` : undefined} onCheckedChange={(c) => onChange(c === true)} />
      <div className="space-y-0.5">
        <Label htmlFor={id} className="font-normal">
          {label}
        </Label>
        {hint && (
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}

function OptionSelect({ id, label, value, onChange, children }: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
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

/** Kind-specific options (max length, slug source, number format, currency, reference target, taxonomy, multiple). */
function FieldOptions({ field, targets, fields, accept, onAccept, onChange }: {
  field: FieldDefinition;
  targets: ContentTypeDefinition[];
  fields: FieldDefinition[];
  accept: string;
  onAccept: (value: string) => void;
  onChange: (options: Record<string, any>) => void;
}) {
  const o = field.options;
  const set = (patch: Record<string, any>) => onChange({ ...o, ...patch });
  const id = (name: string) => `field-opt-${name}`;
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
          <OptionSelect id={id('currencyMode')} label={t('builder.options.currency')} value={o.currencyMode ?? 'market'} onChange={(v) => set({ currencyMode: v })}>
            <SelectItem value="market">{t('builder.options.fromMarket')}</SelectItem>
            <SelectItem value="fixed">{t('builder.options.fixed')}</SelectItem>
          </OptionSelect>
          {o.currencyMode === 'fixed' && (
            <div className="space-y-2">
              <Label htmlFor={id('currency')}>{t('builder.options.isoCode')}</Label>
              <Input id={id('currency')} className="w-24" value={o.currency ?? ''} maxLength={3} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} />
            </div>
          )}
        </>
      );
    case 'reference':
      return (
        <>
          <OptionSelect id={id('target')} label={t('builder.options.targetType')} value={o.target || NONE} onChange={(v) => set({ target: v === NONE ? '' : v })}>
            <SelectItem value={NONE}>{t('builder.options.selectType')}</SelectItem>
            {targets.map((type) => (
              <SelectItem key={type.id} value={type.apiId}>
                {typeName(type)}
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
            <Input id={id('taxonomy')} value={o.taxonomy ?? ''} onChange={(e) => set({ taxonomy: e.target.value })} placeholder={t('builder.options.taxonomyPlaceholder')} />
          </div>
          <CheckField id={id('multiple')} label={t('builder.options.multiple')} checked={!!o.multiple} onChange={(c) => set({ multiple: c })} />
        </>
      );
    case 'asset':
      return (
        <>
          <CheckField id={id('multiple')} label={t('builder.options.multiple')} checked={!!o.multiple} onChange={(c) => set({ multiple: c })} />
          <div className="space-y-2">
            <Label htmlFor="field-accept">{t('contentTypes.accept')}</Label>
            <Input id="field-accept" value={accept} aria-describedby="field-accept-hint" placeholder="image/png, application/pdf" onChange={(e) => onAccept(e.target.value)} />
            <p id="field-accept-hint" className="text-xs text-muted-foreground">
              {t('contentTypes.acceptHint')}
            </p>
          </div>
        </>
      );
    default:
      return null;
  }
}

const acceptText = (f: FieldDefinition) => (Array.isArray(f.options.accept) ? (f.options.accept as string[]).join(', ') : '');
const parseAccept = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/** Name rules: camelCase, not reserved, unique within the type. */
export function fieldNameSchema(others: FieldDefinition[]) {
  return z
    .string()
    .regex(FIELD_NAME_RE, t('contentTypes.fieldNameInvalid'))
    .refine((n) => !RESERVED_FIELD_NAMES.includes(n), t('contentTypes.fieldNameReserved'))
    .refine((n) => !others.some((f) => f.name === n), t('contentTypes.fieldNameTaken'));
}

/** The field with the accept text applied: `accept` only when non-empty, `readOnly` only when true. */
function finish(draft: FieldDefinition, accept: string, original: FieldDefinition | null): FieldDefinition {
  if (original && JSON.stringify(draft) === JSON.stringify(original) && accept === acceptText(original)) return original;
  const { readOnly, ...rest } = draft;
  const options = { ...rest.options };
  if (rest.kind === 'asset') {
    const list = parseAccept(accept);
    if (list.length) options.accept = list;
    else delete options.accept;
  }
  for (const k of Object.keys(options)) if (options[k] === undefined) delete options[k];
  return { ...rest, options, ...(readOnly ? { readOnly: true } : {}) };
}

interface FieldSheetProps {
  /** The field being edited (a fresh one when adding); `null` closes the sheet. */
  field: FieldDefinition | null;
  isNew: boolean;
  /** The other fields of the type (slug source, name uniqueness). */
  siblings: FieldDefinition[];
  types: ContentTypeDefinition[];
  kinds: FieldKind[];
  privateType: boolean;
  onApply: (field: FieldDefinition) => void;
  onClose: () => void;
}

/** Right-side Sheet to add or edit one field; Apply puts it into the type form (saved with the type). */
export function FieldSheet({ field, isNew, siblings, types, kinds, privateType, onApply, onClose }: FieldSheetProps) {
  const [draft, setDraft] = useState<FieldDefinition | null>(field);
  const [accept, setAccept] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(field ? structuredClone(field) : null);
    setAccept(field ? acceptText(field) : '');
    setNameError(null);
  }, [field]);

  const update = (patch: Partial<FieldDefinition>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const apply = () => {
    if (!draft) return;
    const parsed = fieldNameSchema(siblings).safeParse(draft.name);
    if (!parsed.success) {
      setNameError(parsed.error.issues[0]?.message ?? t('contentTypes.fieldNameInvalid'));
      return;
    }
    const next = privateType && draft.localizable ? { ...draft, localizable: false } : draft;
    onApply(finish(next, accept, isNew ? null : field));
  };

  const multiple = draft ? isMultiple(draft) : false;
  return (
    <Sheet open={field !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{isNew ? t('builder.newField') : t('contentTypes.fieldSheetEditTitle')}</SheetTitle>
          <SheetDescription>{t('contentTypes.fieldSheetDescription')}</SheetDescription>
        </SheetHeader>
        {draft && (
          <form
            className="grid gap-4 px-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              apply();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="field-name">{t('builder.fieldName')}</Label>
              <Input
                id="field-name"
                value={draft.name}
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? 'field-name-error' : undefined}
                placeholder={t('builder.fieldNamePlaceholder')}
                onChange={(e) => {
                  update({ name: e.target.value });
                  setNameError(null);
                }}
              />
              {nameError && (
                <p id="field-name-error" className="text-sm text-destructive">
                  {nameError}
                </p>
              )}
              {!isNew && <p className="font-mono text-xs text-muted-foreground">{draft.id}</p>}
            </div>
            <OptionSelect id="field-kind" label={t('builder.fieldKind')} value={draft.kind} onChange={(v) => update({ kind: v as FieldKind, options: {} })}>
              {(kinds.length ? kinds : ALL_KINDS).map((k) => (
                <SelectItem key={k} value={k}>
                  {t(`builder.kinds.${k}`)}
                </SelectItem>
              ))}
            </OptionSelect>
            <div className="space-y-2">
              <Label htmlFor="field-label">{t('builder.fieldLabel')}</Label>
              <Input id="field-label" value={draft.label ?? ''} onChange={(e) => update({ label: e.target.value || undefined })} />
            </div>
            <FieldOptions
              field={draft}
              targets={referenceTargets(types, privateType)}
              fields={siblings}
              accept={accept}
              onAccept={setAccept}
              onChange={(options) => update({ options })}
            />
            <div className="grid gap-3">
              <CheckField id="field-required" label={t('builder.required')} checked={draft.required} onChange={(c) => update({ required: c })} />
              <CheckField
                id="field-localizable"
                label={t('builder.localizable')}
                hint={privateType ? t('contentTypes.privateNoLocalizable') : undefined}
                checked={draft.localizable && !privateType}
                disabled={multiple || privateType}
                onChange={(c) => update({ localizable: c })}
              />
              <CheckField
                id="field-indexed"
                label={t('builder.indexed')}
                checked={draft.indexed || draft.unique}
                disabled={multiple || draft.unique}
                onChange={(c) => update({ indexed: c })}
              />
              <CheckField
                id="field-unique"
                label={t('builder.unique')}
                checked={draft.unique}
                disabled={multiple}
                onChange={(c) => update({ unique: c, indexed: c || draft.indexed })}
              />
              <CheckField
                id="field-readOnly"
                label={t('contentTypes.readOnly')}
                hint={t('contentTypes.readOnlyHint')}
                checked={!!draft.readOnly}
                onChange={(c) => update({ readOnly: c || undefined })}
              />
            </div>
          </form>
        )}
        <SheetFooter className="flex-row justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={apply}>
            {t('contentTypes.apply')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
