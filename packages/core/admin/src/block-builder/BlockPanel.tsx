// Right panel when no element is selected: the block itself (labels, name, category, icon, kind), its manual fields and
// the content binding (URL pattern; collection: fixed filters, sort, limit, layout, page-builder options, empty text).
import { PlusIcon, TrashIcon, XIcon } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { COMPOSED_FIELD_KINDS, SUPPORTED_LOCALES, type ComposedBinding, type ComposedField, type ComposedFieldKind, type LocalizedText } from '@opencloudcms/schema';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Switch } from '../components/ui/switch';
import { t } from '../i18n';
import { useBuilder } from './context';
import { defaultFilterValue, filterValueKind, filterableFields, isListy, sortableFields, suggestFieldName, suggestName, unindexedFields } from './logic';

const CATEGORIES = ['basic', 'layout', 'marketing', 'data'];

function Section({ title, children, hint }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-b border-border pb-4 last:border-b-0">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Row({ label, children, hint }: { label: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {children(id)}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function OnOff({ label, checked, disabled, onChange, hint }: { label: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const id = useId();
  return (
    <div className="flex items-start gap-2">
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
      <div>
        <Label htmlFor={id} className="font-normal">
          {label}
        </Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

function LocalizedInputs({ value, onChange, disabled, name }: { value: Partial<LocalizedText>; onChange: (v: Partial<LocalizedText>) => void; disabled: boolean; name: string }) {
  // Puck renders the field panel more than once (layouts): ids come from useId, `data-input` names the input for tests.
  const idPrefix = useId();
  return (
    <div className="space-y-1.5">
      {SUPPORTED_LOCALES.map((l) => (
        <div key={l.code} className="flex items-center gap-2">
          <Label htmlFor={`${idPrefix}-${l.code}`} className="w-14 shrink-0 font-mono text-xs font-normal text-muted-foreground">
            {l.code}
          </Label>
          <Input
            id={`${idPrefix}-${l.code}`}
            data-input={`${name}-${l.code}`}
            value={value[l.code] ?? ''}
            readOnly={disabled}
            aria-required={l.code === 'en-US'}
            aria-label={`${l.name}${l.code === 'en-US' ? ` · ${t('blockBuilder.required')}` : ''}`}
            onChange={(e) => onChange({ ...value, [l.code]: e.target.value })}
          />
        </div>
      ))}
    </div>
  );
}

// ---- manual fields -----------------------------------------------------------------------------------------------

function OptionsEditor({ field, onChange, disabled }: { field: ComposedField; onChange: (f: ComposedField) => void; disabled: boolean }) {
  const [text, setText] = useState('');
  const id = useId();
  const options = field.options ?? [];
  const add = () => {
    const v = text.trim();
    if (!v || options.includes(v)) return;
    onChange({ ...field, options: [...options, v] });
    setText('');
  };
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
        {t('blockBuilder.fields.options')}
      </Label>
      <ul className="flex flex-wrap gap-1">
        {options.map((o) => (
          <li key={String(o)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs">
            {String(o)}
            {!disabled && (
              <button
                type="button"
                className="rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
                aria-label={t('blockBuilder.fields.removeOption', { option: String(o) })}
                onClick={() => {
                  const next = options.filter((x) => x !== o);
                  const { default: d, ...rest } = field;
                  onChange({ ...rest, options: next, ...(d !== undefined && d !== o ? { default: d } : {}) });
                }}
              >
                <XIcon aria-hidden="true" className="size-3" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {!disabled && (
        <div className="flex gap-1">
          <Input
            id={id}
            value={text}
            placeholder={t('blockBuilder.fields.optionPlaceholder')}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button type="button" variant="outline" size="sm" onClick={add}>
            {t('blockBuilder.fields.addOption')}
          </Button>
        </div>
      )}
      {options.length === 0 && <p className="text-xs text-warning">{t('blockBuilder.fields.optionsRequired')}</p>}
    </div>
  );
}

function DefaultEditor({ field, onChange, disabled }: { field: ComposedField; onChange: (f: ComposedField) => void; disabled: boolean }) {
  const id = useId();
  const set = (v: unknown) => {
    const { default: _d, ...rest } = field;
    onChange(v === undefined || v === '' ? rest : { ...rest, default: v });
  };
  let control: ReactNode = null;
  switch (field.kind) {
    case 'text':
    case 'longText':
      control = <Input id={id} value={typeof field.default === 'string' ? field.default : ''} readOnly={disabled} onChange={(e) => set(e.target.value)} />;
      break;
    case 'number':
      control = (
        <Input
          id={id}
          type="number"
          step="any"
          readOnly={disabled}
          value={typeof field.default === 'number' ? field.default : ''}
          onChange={(e) => set(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      );
      break;
    case 'boolean':
      control = <Switch id={id} checked={field.default === true} disabled={disabled} onCheckedChange={(v) => set(v)} />;
      break;
    case 'select':
      control = (
        <Select value={field.default === undefined ? '__none' : String(field.default)} disabled={disabled} onValueChange={(v) => set(v === '__none' ? undefined : (field.options ?? []).find((o) => String(o) === v))}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">{t('blockBuilder.fields.noDefault')}</SelectItem>
            {(field.options ?? []).map((o) => (
              <SelectItem key={String(o)} value={String(o)}>
                {String(o)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      break;
    default:
      return null;
  }
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
        {t('blockBuilder.fields.default')}
      </Label>
      {control}
    </div>
  );
}

function fieldLabelText(f: ComposedField): string {
  return typeof f.label === 'string' ? f.label : (f.label?.['en-US'] ?? '');
}

function ManualFields() {
  const m = useBuilder();
  const [kind, setKind] = useState<ComposedFieldKind>('text');
  const [label, setLabel] = useState('');
  const newLabelId = useId();
  const newKindId = useId();
  const entries = Object.entries(m.draft.fields);
  const setField = (name: string, f: ComposedField) => m.setDraft((d) => ({ ...d, fields: { ...d.fields, [name]: f } }));
  const remove = (name: string) =>
    m.setDraft((d) => {
      const { [name]: _drop, ...rest } = d.fields;
      return { ...d, fields: rest };
    });
  const add = () => {
    const name = suggestFieldName(label || t(`blockBuilder.fieldKinds.${kind}`), m.draft.fields);
    m.addField(name, { kind, label: { 'en-US': label.trim() || name }, ...(kind === 'select' ? { options: [] } : {}) });
    setLabel('');
  };

  return (
    <Section title={t('blockBuilder.fields.title')} hint={t('blockBuilder.fields.hint')}>
      {entries.length === 0 && <p className="text-sm text-muted-foreground">{t('blockBuilder.fields.empty')}</p>}
      <ul className="space-y-2">
        {entries.map(([name, f]) => {
          const used = m.fieldUsage(name);
          return (
            <li key={name} className="space-y-2 rounded-md border border-border p-2">
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate text-xs">{name}</code>
                {!m.readOnly && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={used > 0}
                    title={used > 0 ? t('blockBuilder.fields.inUse', { count: used }) : undefined}
                    aria-label={t('blockBuilder.fields.remove', { name })}
                    onClick={() => remove(name)}
                  >
                    <TrashIcon aria-hidden="true" />
                  </Button>
                )}
              </div>
              {used > 0 && <p className="text-xs text-muted-foreground">{t('blockBuilder.fields.inUse', { count: used })}</p>}
              <Row label={t('blockBuilder.fields.label')}>
                {(id) => (
                  <Input
                    id={id}
                    value={fieldLabelText(f)}
                    readOnly={m.readOnly}
                    onChange={(e) => setField(name, { ...f, label: { ...(typeof f.label === 'object' ? f.label : {}), 'en-US': e.target.value } })}
                  />
                )}
              </Row>
              <Row label={t('blockBuilder.fields.kind')}>
                {(id) => (
                  <Select
                    value={f.kind}
                    disabled={m.readOnly}
                    onValueChange={(k) => {
                      const { default: _d, options: _o, ...rest } = f;
                      setField(name, { ...rest, kind: k as ComposedFieldKind, ...(k === 'select' ? { options: [] } : {}) });
                    }}
                  >
                    <SelectTrigger id={id} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COMPOSED_FIELD_KINDS.map((k) => (
                        <SelectItem key={k} value={k}>
                          {t(`blockBuilder.fieldKinds.${k}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Row>
              {f.kind === 'select' && <OptionsEditor field={f} disabled={m.readOnly} onChange={(n) => setField(name, n)} />}
              <DefaultEditor field={f} disabled={m.readOnly} onChange={(n) => setField(name, n)} />
            </li>
          );
        })}
      </ul>
      {!m.readOnly && (
        <div className="space-y-2 rounded-md border border-dashed border-border p-2">
          <div className="space-y-1">
            <Label htmlFor={newLabelId} className="text-xs font-normal text-muted-foreground">
              {t('blockBuilder.fields.newLabel')}
            </Label>
            <Input id={newLabelId} value={label} placeholder={t('blockBuilder.fields.newLabelPlaceholder')} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <Label htmlFor={newKindId} className="text-xs font-normal text-muted-foreground">
                {t('blockBuilder.fields.kind')}
              </Label>
              <Select value={kind} onValueChange={(k) => setKind(k as ComposedFieldKind)}>
                <SelectTrigger id={newKindId} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMPOSED_FIELD_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {t(`blockBuilder.fieldKinds.${k}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={add}>
              <PlusIcon aria-hidden="true" />
              {t('blockBuilder.fields.add')}
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}

// ---- binding -----------------------------------------------------------------------------------------------------

function Binding({ binding }: { binding: ComposedBinding }) {
  const m = useBuilder();
  const type = m.type;
  const set = (patch: Partial<ComposedBinding>) => m.setDraft((d) => ({ ...d, binding: { ...d.binding!, ...patch } }));
  const setOptions = (patch: NonNullable<ComposedBinding['options']>) => set({ options: { ...(binding.options ?? {}), ...patch } });
  const collection = binding.mode === 'collection';
  const filterable = type ? filterableFields(type) : [];
  const unindexed = type ? unindexedFields(type) : [];
  const filters = binding.filter ?? [];
  const placeholders = type ? type.fields.filter((f) => !isListy(f) && ['text', 'slug', 'number'].includes(f.kind)).map((f) => f.name) : [];

  if (!type) {
    return (
      <Section title={t('blockBuilder.binding.title')}>
        <p className="text-sm text-warning">{t('blockBuilder.binding.missingType', { type: binding.apiId })}</p>
      </Section>
    );
  }

  return (
    <Section title={t('blockBuilder.binding.title')} hint={t(collection ? 'blockBuilder.binding.collectionHint' : 'blockBuilder.binding.singleHint')}>
      <Row label={t('blockBuilder.binding.urlPattern')} hint={t('blockBuilder.binding.urlPatternHint')}>
        {(id) => (
          <div className="space-y-1">
            <Input id={id} value={binding.urlPattern ?? ''} readOnly={m.readOnly} placeholder="/products/{slug}" onChange={(e) => set({ urlPattern: e.target.value })} />
            {!m.readOnly && placeholders.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {placeholders.map((p) => (
                  <Button key={p} type="button" variant="outline" size="sm" className="h-6 px-2 font-mono text-xs" onClick={() => set({ urlPattern: `${binding.urlPattern ?? ''}{${p}}` })}>
                    {`{${p}}`}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
      </Row>

      {collection && (
        <>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('blockBuilder.binding.filters')}</legend>
            <p className="text-xs text-muted-foreground">{t('blockBuilder.binding.filtersHint')}</p>
            {filters.map((flt, i) => {
              const def = type.fields.find((f) => f.name === flt.field);
              const vk = def ? filterValueKind(def) : 'string';
              const setRow = (row: { field: string; value: unknown }) => set({ filter: filters.map((x, j) => (j === i ? row : x)) });
              return (
                <div key={i} className="space-y-1 rounded-md border border-border p-2">
                  <div className="flex items-center gap-1">
                    <Select
                      value={flt.field}
                      disabled={m.readOnly}
                      onValueChange={(name) => {
                        const f = type.fields.find((x) => x.name === name);
                        if (f) setRow({ field: name, value: defaultFilterValue(f) });
                      }}
                    >
                      <SelectTrigger className="w-full" aria-label={t('blockBuilder.binding.filterField')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {filterable.map((f) => (
                          <SelectItem key={f.name} value={f.name}>
                            {f.label || f.name}
                          </SelectItem>
                        ))}
                        {unindexed.map((f) => (
                          <SelectItem key={f.name} value={f.name} disabled>
                            {t('blockBuilder.binding.notIndexed', { name: f.label || f.name })}
                          </SelectItem>
                        ))}
                        {!def && flt.field && (
                          <SelectItem value={flt.field} disabled>
                            {t('blockBuilder.source.unavailable', { name: flt.field })}
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    {!m.readOnly && (
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={t('blockBuilder.binding.removeFilter')} onClick={() => set({ filter: filters.filter((_, j) => j !== i) })}>
                        <XIcon aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">{t('blockBuilder.binding.equals')}</span>
                    {vk === 'boolean' ? (
                      <Switch checked={flt.value === true} disabled={m.readOnly} aria-label={t('blockBuilder.binding.filterValue')} onCheckedChange={(v) => setRow({ ...flt, value: v })} />
                    ) : (
                      <Input
                        type={vk === 'number' ? 'number' : 'text'}
                        step="any"
                        readOnly={m.readOnly}
                        aria-label={t('blockBuilder.binding.filterValue')}
                        value={vk === 'number' ? (typeof flt.value === 'number' ? flt.value : '') : typeof flt.value === 'string' ? flt.value : ''}
                        onChange={(e) => setRow({ ...flt, value: vk === 'number' ? Number(e.target.value || 0) : e.target.value })}
                      />
                    )}
                  </div>
                </div>
              );
            })}
            {!m.readOnly && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={filterable.length === 0}
                onClick={() => set({ filter: [...filters, { field: filterable[0]!.name, value: defaultFilterValue(filterable[0]!) }] })}
              >
                <PlusIcon aria-hidden="true" />
                {t('blockBuilder.binding.addFilter')}
              </Button>
            )}
            {unindexed.length > 0 && <p className="text-xs text-muted-foreground">{t('blockBuilder.binding.indexHint')}</p>}
          </fieldset>

          <Row label={t('blockBuilder.binding.sort')}>
            {(id) => (
              <div className="flex gap-1">
                <Select
                  value={binding.sort?.field ?? '__none'}
                  disabled={m.readOnly}
                  onValueChange={(v) => set({ sort: v === '__none' ? undefined : { field: v, direction: binding.sort?.direction ?? 'desc' } })}
                >
                  <SelectTrigger id={id} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">{t('blockBuilder.binding.sortNone')}</SelectItem>
                    {sortableFields(type).map((f) => (
                      <SelectItem key={f} value={f}>
                        {t(`blockBuilder.source.meta.${f}`) !== `blockBuilder.source.meta.${f}` ? t(`blockBuilder.source.meta.${f}`) : (type.fields.find((x) => x.name === f)?.label ?? f)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {binding.sort && (
                  <Select value={binding.sort.direction} disabled={m.readOnly} onValueChange={(v) => set({ sort: { field: binding.sort!.field, direction: v as 'asc' | 'desc' } })}>
                    <SelectTrigger className="w-28 shrink-0" aria-label={t('blockBuilder.binding.direction')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="asc">{t('blockBuilder.binding.asc')}</SelectItem>
                      <SelectItem value="desc">{t('blockBuilder.binding.desc')}</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
          </Row>

          <Row label={t('blockBuilder.binding.limit')} hint={t('blockBuilder.binding.limitHint')}>
            {(id) => (
              <Input
                id={id}
                type="number"
                min={1}
                max={100}
                readOnly={m.readOnly}
                value={binding.limit ?? 12}
                onChange={(e) => set({ limit: e.target.value === '' ? undefined : Math.round(Number(e.target.value)) })}
              />
            )}
          </Row>

          <Row label={t('blockBuilder.binding.layout')}>
            {(id) => (
              <div className="flex gap-1">
                <Select
                  value={binding.layout?.kind ?? 'grid'}
                  disabled={m.readOnly}
                  onValueChange={(k) => set({ layout: k === 'list' ? { kind: 'list' } : { kind: 'grid', columns: binding.layout?.columns ?? 3 } })}
                >
                  <SelectTrigger id={id} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="grid">{t('blockBuilder.binding.grid')}</SelectItem>
                    <SelectItem value="list">{t('blockBuilder.binding.list')}</SelectItem>
                  </SelectContent>
                </Select>
                {binding.layout?.kind !== 'list' && (
                  <Select value={String(binding.layout?.columns ?? 3)} disabled={m.readOnly} onValueChange={(c) => set({ layout: { kind: 'grid', columns: Number(c) } })}>
                    <SelectTrigger className="w-32 shrink-0" aria-label={t('blockBuilder.binding.columns')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[2, 3, 4, 5, 6].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {t('blockBuilder.binding.columnsN', { count: n })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
          </Row>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('blockBuilder.binding.editorOptions')}</legend>
            {(['editorFilter', 'editorSort', 'editorLimit', 'editorLayout'] as const).map((k) => (
              <OnOff key={k} label={t(`blockBuilder.binding.${k}`)} checked={binding.options?.[k] === true} disabled={m.readOnly} onChange={(v) => setOptions({ [k]: v })} />
            ))}
          </fieldset>

          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">{t('blockBuilder.binding.emptyText')}</legend>
            <p className="text-xs text-muted-foreground">{t('blockBuilder.binding.emptyTextHint')}</p>
            <LocalizedInputs name="block-empty" value={binding.options?.emptyText ?? {}} disabled={m.readOnly} onChange={(v) => setOptions({ emptyText: v as LocalizedText })} />
          </fieldset>
        </>
      )}
    </Section>
  );
}

// ---- panel -------------------------------------------------------------------------------------------------------

/** Block settings: shown in Puck's field panel while no element is selected. */
export function BlockPanel() {
  const m = useBuilder();
  const d = m.draft;
  const setLabel = (label: Partial<LocalizedText>) =>
    m.setDraft((x) => {
      // Keep the name in step with the en-US label until the user types their own (only before the first save).
      const follow = !m.nameLocked && (x.name === '' || x.name === suggestName(x.label));
      return { ...x, label, ...(follow ? { name: suggestName(label) } : {}) };
    });
  return (
    <div className="space-y-4 p-4">
      <Section title={t('blockBuilder.block.title')} hint={t('blockBuilder.block.hint')}>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">{t('blockBuilder.block.label')}</legend>
          <LocalizedInputs name="block-label" value={d.label} disabled={m.readOnly} onChange={setLabel} />
        </fieldset>
        <Row label={t('blockBuilder.block.name')} hint={t(m.nameLocked ? 'blockBuilder.block.nameLocked' : 'blockBuilder.block.nameHint')}>
          {(id) => (
            <Input
              id={id}
              className="font-mono"
              value={d.name}
              readOnly={m.readOnly || m.nameLocked}
              placeholder="ProductCard"
              onChange={(e) => m.setDraft((x) => ({ ...x, name: e.target.value.replace(/[^A-Za-z0-9]/g, '') }))}
            />
          )}
        </Row>
        <Row label={t('blockBuilder.block.category')} hint={t('blockBuilder.block.categoryHint')}>
          {(id) => (
            <>
              <Input id={id} list={`${id}-list`} value={d.category} readOnly={m.readOnly} onChange={(e) => m.setDraft((x) => ({ ...x, category: e.target.value }))} />
              <datalist id={`${id}-list`}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </>
          )}
        </Row>
        <Row label={t('blockBuilder.block.icon')} hint={t('blockBuilder.block.iconHint')}>
          {(id) => <Input id={id} value={d.icon ?? ''} readOnly={m.readOnly} placeholder="shopping-bag" onChange={(e) => m.setDraft((x) => ({ ...x, icon: e.target.value }))} />}
        </Row>
        <div data-block-kind={m.kind} className="space-y-0.5 text-sm">
          <p className="font-medium">{t('blockBuilder.kindInfo.label')}</p>
          <p className="text-xs text-muted-foreground">{t(`blockBuilder.kindInfo.${m.kind}`)}</p>
        </div>
      </Section>
      <ManualFields />
      {d.binding ? (
        <Binding binding={d.binding} />
      ) : (
        <Section title={t('blockBuilder.binding.title')}>
          <p className="text-sm text-muted-foreground">{t('blockBuilder.binding.none')}</p>
        </Section>
      )}
    </div>
  );
}
