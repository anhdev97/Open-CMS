// Slug input of the entry form (collection list spec §2): read-only without a pattern (the value is the entry id);
// with a pattern, editable with the generated value shown and "Regenerate" (an empty value asks the server for the
// pattern again).
import { renderSlugPattern, SLUG_MAX_LENGTH, slugPattern } from '@opencloudcms/schema';
import { RotateCcwIcon } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { t } from '../../i18n';
import type { FieldDefinition } from '../../lib/types';

/** The field's pattern (legacy `from` read as `{from}`), or null: the slug is then the entry id. */
export const fieldPattern = (f: FieldDefinition): string | null => slugPattern(f as never);

/**
 * What the server would generate for `values` (the default/locale values the form holds); `''` when the pattern
 * renders nothing yet. `documentId` is unknown before the first save: `{id}` parts are then left out.
 */
export function generatedSlug(f: FieldDefinition, values: Record<string, unknown>, documentId: string | null, locale: string): string {
  const pattern = fieldPattern(f);
  if (!pattern) return documentId ?? '';
  const max = typeof f.options.maxLength === 'number' ? f.options.maxLength : SLUG_MAX_LENGTH;
  return renderSlugPattern(pattern, values, documentId ?? '', locale, max);
}

export function SlugField({
  id,
  field,
  value,
  values,
  documentId,
  locale,
  disabled,
  invalid,
  describedBy,
  onChange,
}: {
  id: string;
  field: FieldDefinition;
  value: unknown;
  values: Record<string, unknown>;
  documentId: string | null;
  locale: string;
  disabled: boolean;
  invalid?: boolean;
  describedBy?: string;
  onChange: (v: unknown) => void;
}) {
  const pattern = fieldPattern(field);
  const current = typeof value === 'string' ? value : '';
  if (!pattern) {
    return (
      <div className="space-y-1">
        <Input id={id} className="font-mono" value={current || documentId || ''} placeholder={t('content.slug.idOnSave')} readOnly aria-readonly="true" aria-describedby={describedBy} />
        <p className="text-xs text-muted-foreground">{t('content.slug.idHint')}</p>
      </div>
    );
  }
  const generated = generatedSlug(field, values, documentId, locale);
  // Empty: the server fills the pattern result on save.
  const follows = current === '' || current === generated;
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <Input
          id={id}
          className="font-mono"
          value={current}
          placeholder={generated || t('content.slug.generatedOnSave')}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
        />
        <Button type="button" variant="outline" disabled={disabled || current === ''} onClick={() => onChange('')} title={t('content.slug.regenerateHint')}>
          <RotateCcwIcon aria-hidden="true" />
          {t('content.slug.regenerate')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {follows
          ? t('content.slug.patternHint', { pattern, example: generated || '…' })
          : t('content.slug.customHint', { pattern })}
      </p>
    </div>
  );
}
