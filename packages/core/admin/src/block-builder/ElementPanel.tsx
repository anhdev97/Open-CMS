// Custom Puck fields of the element panel (right side, when an element is selected): the sources of its bindable
// props, "show when", a Slot's allowed blocks and the name / anchor id texts. Token props use the page editor's fields.
import { useEffect, useId, useRef, useState } from 'react';
import type { CustomFieldRender } from '@puckeditor/core';
import { ANCHOR_ID_RE, ELEMENT_BINDABLE, FORM_CONTROL_NAME_RE, OVERLAY_NAME_RE, type BindSource, type ComposedElement, type ComposedNode } from '@opencloudcms/schema';
import { Checkbox } from '../components/ui/checkbox';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '../components/ui/select';
import { t } from '../i18n';
import { useLocale } from '../i18n/hooks';
import { FieldShell, fieldLabel } from '../page-editor/FieldShell';
import { useBindScope, useBuilder } from './context';
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
  const scope = useBindScope();
  const entryFields = scope.type ? scope.type.fields.filter((f) => !isListy(f)) : [];
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
                    <SelectLabel>{t('blockBuilder.source.contentGroup', { type: scope.apiId })}</SelectLabel>
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

/**
 * A text checked against a name pattern (`metadata.pattern`): `name` (Region names, required), `control` (form
 * control names, `FORM_CONTROL_NAME_RE`, required) or `anchor` (`anchorId`, optional). An invalid text shows an
 * inline error and is not written; empty clears an optional value.
 */
export const PatternField: CustomFieldRender<unknown> = ({ field, name, id, value, onChange, readOnly }) => {
  const m = useBuilder();
  const meta = (field.metadata ?? {}) as { pattern?: 'name' | 'anchor' | 'control'; required?: boolean };
  const kind = meta.pattern ?? 'anchor';
  const re = kind === 'name' ? OVERLAY_NAME_RE : kind === 'control' ? FORM_CONTROL_NAME_RE : ANCHOR_ID_RE;
  const stored = typeof value === 'string' ? value : '';
  const [text, setText] = useState(stored);
  const last = useRef(stored);
  useEffect(() => {
    if (stored === last.current) return;
    last.current = stored;
    setText(stored);
  }, [stored]);

  const v = text.trim();
  const error = !v ? (meta.required ? t('blockBuilder.pattern.required') : null) : re.test(v) ? null : t(`blockBuilder.pattern.${kind}`);
  // Region names are unique in the block (the stored name counts once for this Region).
  const duplicate = !error && kind === 'name' && v && m.regionCount(v) > (v === stored ? 1 : 0) ? t('blockBuilder.pattern.duplicateRegion', { name: v }) : null;
  const msgId = `${id}-msg`;
  return (
    <FieldShell id={id} label={fieldLabel(field, name)}>
      <Input
        id={id}
        data-pattern={kind}
        value={text}
        disabled={readOnly || m.readOnly}
        aria-invalid={error || duplicate ? true : undefined}
        aria-describedby={msgId}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          const n = next.trim();
          if (n ? !re.test(n) : meta.required) return;
          if (kind === 'name' && n && m.regionCount(n) > (n === stored ? 1 : 0)) return; // duplicate Region name
          const out = n || undefined;
          last.current = n;
          onChange(out);
        }}
      />
      <div id={msgId}>
        {(error || duplicate) && <p className="text-xs text-destructive">{error ?? duplicate}</p>}
      </div>
    </FieldShell>
  );
};

/**
 * Region `label`: a plain text, edited here; a localized label (written in code) is shown read-only in the admin
 * language, so editing never overwrites its other locales.
 */
export const RegionLabelField: CustomFieldRender<unknown> = ({ field, name, id, value, onChange, readOnly }) => {
  const m = useBuilder();
  const locale = useLocale();
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const l = value as Record<string, unknown>;
    const pickText = (k: string) => (typeof l[k] === 'string' && l[k] ? (l[k] as string) : undefined);
    const shown = pickText(locale) ?? pickText('en-US') ?? Object.values(l).find((v): v is string => typeof v === 'string' && !!v) ?? '';
    return (
      <FieldShell id={id} label={fieldLabel(field, name)}>
        <Input id={id} value={shown} readOnly aria-describedby={`${id}-msg`} />
        <p id={`${id}-msg`} className="text-xs text-muted-foreground">
          {t('blockBuilder.regionLabelLocalized')}
        </p>
      </FieldShell>
    );
  }
  return (
    <FieldShell id={id} label={fieldLabel(field, name)}>
      <Input
        id={id}
        value={typeof value === 'string' ? value : ''}
        disabled={readOnly || m.readOnly}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
      />
    </FieldShell>
  );
};
