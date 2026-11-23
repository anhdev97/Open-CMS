import { useEffect, useState } from 'react';
import type { CustomFieldRender } from '@puckeditor/core';
import type { StoredLink } from '@opencloudcms/core/blocks';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { t } from '../i18n';
import type { PageEntry } from '../lib/pages';
import { FieldShell, fieldLabel } from './FieldShell';
import { loadPages } from './data';
import { useEditorInfo } from './editor-context';

const NONE = '__none__';

/** `b.link`: none, a URL, or another page (stored by documentId, resolved to its path per locale). */
export const LinkField: CustomFieldRender<StoredLink | null> = ({ field, name, id, value, onChange, readOnly }) => {
  const { locale } = useEditorInfo();
  const [pages, setPages] = useState<PageEntry[]>([]);
  const kind = value?.kind ?? NONE;
  useEffect(() => {
    if (kind !== 'page') return;
    let live = true;
    loadPages(locale)
      .then((p) => live && setPages(p))
      .catch(() => live && setPages([]));
    return () => {
      live = false;
    };
  }, [kind, locale]);

  return (
    <FieldShell id={`${id}-kind`} label={fieldLabel(field, name)}>
      <div className="space-y-2">
        <Select
          value={kind}
          disabled={readOnly}
          onValueChange={(k) => onChange(k === 'url' ? { kind: 'url', href: '' } : k === 'page' ? { kind: 'page', documentId: '' } : null)}
        >
          <SelectTrigger id={`${id}-kind`} className="w-full" aria-label={t('pageEditor.fields.link.kind')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t('pageEditor.fields.none')}</SelectItem>
            <SelectItem value="url">{t('pageEditor.fields.link.url')}</SelectItem>
            <SelectItem value="page">{t('pageEditor.fields.link.page')}</SelectItem>
          </SelectContent>
        </Select>
        {value?.kind === 'url' && (
          <Input
            id={id}
            aria-label={t('pageEditor.fields.link.url')}
            placeholder={t('pageEditor.fields.link.urlPlaceholder')}
            value={value.href}
            readOnly={readOnly}
            onChange={(e) => onChange({ kind: 'url', href: e.target.value })}
          />
        )}
        {value?.kind === 'page' && (
          <Select value={value.documentId || undefined} disabled={readOnly} onValueChange={(documentId) => onChange({ kind: 'page', documentId })}>
            <SelectTrigger id={id} className="w-full" aria-label={t('pageEditor.fields.link.page')}>
              <SelectValue placeholder={t('pageEditor.fields.link.pagePlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {pages.map((p) => (
                <SelectItem key={p.documentId} value={p.documentId}>
                  {p.title || t('content.untitled')} <span className="font-mono text-muted-foreground">{p.path}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </FieldShell>
  );
};
