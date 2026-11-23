import { useId } from 'react';
import type { CustomFieldRender } from '@puckeditor/core';
import type { StoredImage } from '@opencloudcms/core/blocks';
import { FieldInput } from '../components/FieldInput';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { t } from '../i18n';
import type { FieldDefinition } from '../lib/types';
import { FieldShell, fieldLabel } from './FieldShell';
import { invalidate, loadAssets } from './data';

// The content editor's asset field (picker, upload, missing-alt fix), reused for one image.
const ASSET_FIELD: FieldDefinition = {
  id: 'page-editor-image',
  name: 'image',
  kind: 'asset',
  required: false,
  localizable: false,
  indexed: false,
  unique: false,
  options: { multiple: false },
};

/** `b.image`: an asset from `@opencloudcms/assets` (pick or upload) or a pasted URL; stores `{ assetId?, src, alt }`. */
export const ImageField: CustomFieldRender<StoredImage | null> = ({ field, name, id, value, onChange, readOnly }) => {
  const altId = useId();
  const urlId = useId();

  const pickAsset = async (assetId: string | null) => {
    if (!assetId) return onChange(null);
    invalidate('assets'); // the picker may just have uploaded it
    const asset = (await loadAssets().catch(() => [])).find((a) => a.id === assetId);
    if (asset) onChange({ assetId, src: asset.url, alt: value?.alt || asset.alt || '' });
  };

  return (
    <FieldShell id={id} label={fieldLabel(field, name)}>
      <div className="space-y-2">
        {readOnly ? null : <FieldInput id={id} field={ASSET_FIELD} value={value?.assetId ?? null} onChange={(v) => void pickAsset(v)} />}
        <div className="space-y-1">
          <Label htmlFor={urlId} className="text-xs text-muted-foreground">
            {t('pageEditor.fields.image.url')}
          </Label>
          <Input
            id={urlId}
            value={value?.src ?? ''}
            readOnly={readOnly}
            placeholder="https://"
            onChange={(e) => onChange(e.target.value ? { src: e.target.value, alt: value?.alt ?? '' } : null)}
          />
        </div>
        {value && (
          <div className="space-y-1">
            <Label htmlFor={altId} className="text-xs text-muted-foreground">
              {t('pageEditor.fields.image.alt')}
            </Label>
            <Input
              id={altId}
              value={value.alt}
              readOnly={readOnly}
              placeholder={t('pageEditor.fields.image.altPlaceholder')}
              onChange={(e) => onChange({ ...value, alt: e.target.value })}
            />
          </div>
        )}
        {value && !readOnly && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            {t('pageEditor.fields.image.remove')}
          </Button>
        )}
      </div>
    </FieldShell>
  );
};
