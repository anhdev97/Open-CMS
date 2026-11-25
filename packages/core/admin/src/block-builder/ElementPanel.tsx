// Custom Puck fields of the element panel (right side, when an element is selected): the sources of its bindable
// props, "show when", and a Slot's allowed blocks. Token props use the page editor's fields.
import { useId } from 'react';
import type { CustomFieldRender } from '@puckeditor/core';
import { ELEMENT_BINDABLE, type BindSource, type ComposedElement, type ComposedNode } from '@opencloudcms/schema';
import { Checkbox } from '../components/ui/checkbox';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '../components/ui/select';
import { t } from '../i18n';
import { FieldShell, fieldLabel } from '../page-editor/FieldShell';
import { useBuilder } from './context';
import { isListy } from './logic';
import { SourcePicker } from './SourcePicker';

type Bind = Record<string, BindSource>;
type ShowIf = NonNullable<ComposedNode['showIf']>;

/** Sources of every bindable prop of the selected element (`metadata.el`). */
export const SourcesField: CustomFieldRender<unknown> = ({ field, value, onChange }) => {
  const el = (field.metadata as { el: ComposedElement }).el;
  const bind = (value && typeof value === 'object' ? value : {}) as Bind;
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{t('blockBuilder.sources')}</legend>
      <p className="text-xs text-muted-foreground">{t('blockBuilder.sourcesHint')}</p>
      {ELEMENT_BINDABLE[el].map((prop) => (
        <SourcePicker
          key={prop}
          el={el}
          prop={prop}
          value={bind[prop]}
          onChange={(s) => {
            const next: Bind = { ...bind };
            if (s) next[prop] = s;
            else delete next[prop];
            onChange(next);
          }}
        />
      ))}
    </fieldset>
  );
};

const ALWAYS = 'always';

/** "Show when": always, or when an entry field / manual field has a value or is empty. */
export const ShowIfField: CustomFieldRender<unknown> = ({ field, name, value, onChange }) => {
  const m = useBuilder();
  const condId = useId();
  const srcId = useId();
  const s = (value && typeof value === 'object' ? value : null) as ShowIf | null;
  const entryFields = m.type ? m.type.fields.filter((f) => !isListy(f)) : [];
  const manual = Object.keys(m.draft.fields);
  const src = s ? (s.from === 'entry' ? `entry:${s.path ?? ''}` : `field:${s.name ?? ''}`) : '';
  const firstSource = entryFields[0] ? `entry:${entryFields[0].name}` : manual[0] ? `field:${manual[0]}` : null;

  const make = (is: 'present' | 'absent', source: string): ShowIf =>
    source.startsWith('entry:') ? { from: 'entry', path: source.slice(6), is } : { from: 'field', name: source.slice(6), is };

  return (
    <FieldShell id={condId} label={fieldLabel(field, name)}>
      <div className="space-y-2">
        <Select
          value={s ? s.is : ALWAYS}
          disabled={m.readOnly || (!s && !firstSource)}
          onValueChange={(v) => {
            if (v === ALWAYS) return onChange(undefined);
            onChange(make(v as 'present' | 'absent', src || firstSource!));
          }}
        >
          <SelectTrigger id={condId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALWAYS}>{t('blockBuilder.showIf.always')}</SelectItem>
            <SelectItem value="present">{t('blockBuilder.showIf.present')}</SelectItem>
            <SelectItem value="absent">{t('blockBuilder.showIf.absent')}</SelectItem>
          </SelectContent>
        </Select>
        {!s && !firstSource && <p className="text-xs text-muted-foreground">{t('blockBuilder.showIf.noSources')}</p>}
        {s && (
          <div className="space-y-1">
            <Label htmlFor={srcId} className="text-xs font-normal text-muted-foreground">
              {t('blockBuilder.showIf.source')}
            </Label>
            <Select value={src} disabled={m.readOnly} onValueChange={(v) => onChange(make(s.is, v))}>
              <SelectTrigger id={srcId} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {entryFields.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>{t('blockBuilder.source.contentGroup', { type: m.type?.apiId ?? '' })}</SelectLabel>
                    {entryFields.map((f) => (
                      <SelectItem key={f.name} value={`entry:${f.name}`}>
                        {f.label || f.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {manual.length > 0 && (
                  <SelectGroup>
                    {entryFields.length > 0 && <SelectSeparator />}
                    <SelectLabel>{t('blockBuilder.source.manualGroup')}</SelectLabel>
                    {manual.map((n) => (
                      <SelectItem key={n} value={`field:${n}`}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </FieldShell>
  );
};

/** Slot `allow`: which page-builder blocks may be dropped into it (none checked = any). */
export const AllowField: CustomFieldRender<unknown> = ({ field, name, value, onChange }) => {
  const m = useBuilder();
  const id = useId();
  const allow = Array.isArray(value) ? (value as string[]) : [];
  const toggle = (block: string, on: boolean) => {
    const next = on ? [...allow, block] : allow.filter((b) => b !== block);
    onChange(next.length ? next : undefined);
  };
  return (
    <FieldShell id={id} as="legend" label={fieldLabel(field, name)}>
      <p className="text-xs text-muted-foreground">{t('blockBuilder.slotAllowHint')}</p>
      <div className="max-h-48 space-y-1 overflow-y-auto">
        {m.pageBlocks.map((b) => (
          <label key={b} className="flex items-center gap-2 text-sm">
            <Checkbox checked={allow.includes(b)} disabled={m.readOnly} onCheckedChange={(c) => toggle(b, c === true)} />
            {b}
          </label>
        ))}
      </div>
    </FieldShell>
  );
};
