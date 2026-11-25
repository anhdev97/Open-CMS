import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { CustomFieldRender } from '@puckeditor/core';
import type { EntryBlockField, StoredEntry } from '@opencloudcms/core/blocks';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { t } from '../i18n';
import type { ContentTypeDefinition } from '../lib/types';
import { FieldShell, PrivateTypeNote, fieldLabel } from './FieldShell';
import { entryLabel, loadContentType, loadEntries, type EntryRow } from './data';
import { useEditorInfo } from './editor-context';

interface EntryPickerProps {
  id: string;
  apiId: string;
  displayField?: string;
  selected: string[];
  multiple: boolean;
  readOnly?: boolean;
  onChange: (ids: string[]) => void;
}

/** Search the drafts of `apiId` (editing locale) and pick one or several; several keep their order (up/down). */
export function EntryPicker({ id, apiId, displayField, selected, multiple, readOnly, onChange }: EntryPickerProps) {
  const { locale } = useEditorInfo();
  const [type, setType] = useState<ContentTypeDefinition | null>(null);
  const [entries, setEntries] = useState<EntryRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!apiId) return;
    let live = true;
    setEntries(null);
    setType(null);
    setFailed(false);
    // The type first: entries of a private type are never loaded (a stored binding to one renders nothing).
    loadContentType(apiId)
      .then(async (ct) => {
        if (!live) return;
        setType(ct);
        if (ct?.private) return;
        const rows = await loadEntries(apiId, locale);
        if (live) setEntries(rows);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [apiId, locale]);

  const label = (docId: string) => {
    const e = entries?.find((x) => x.documentId === docId);
    return e ? entryLabel(e, type, displayField) : docId;
  };
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (entries ?? []).filter((e) => !selected.includes(e.documentId) && (!q || entryLabel(e, type, displayField).toLowerCase().includes(q))).slice(0, 8);
  }, [entries, query, selected, type, displayField]);

  if (!apiId) return <p className="text-sm text-muted-foreground">{t('pageEditor.fields.entry.noType')}</p>;
  if (type?.private) return <PrivateTypeNote apiId={apiId} />;

  const move = (i: number, d: -1 | 1) => {
    const next = [...selected];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <ul aria-label={t('pageEditor.fields.entry.selected')} className="space-y-1">
          {selected.map((docId, i) => (
            <li key={docId} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-sm">
              <span className="min-w-0 flex-1 truncate">{label(docId)}</span>
              {multiple && !readOnly && (
                <>
                  <Button type="button" variant="ghost" size="icon-sm" disabled={i === 0} aria-label={t('pageEditor.fields.entry.moveUp', { label: label(docId) })} onClick={() => move(i, -1)}>
                    <ArrowUpIcon aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={i === selected.length - 1}
                    aria-label={t('pageEditor.fields.entry.moveDown', { label: label(docId) })}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDownIcon aria-hidden="true" />
                  </Button>
                </>
              )}
              {!readOnly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('pageEditor.fields.entry.remove', { label: label(docId) })}
                  onClick={() => onChange(selected.filter((s) => s !== docId))}
                >
                  <XIcon aria-hidden="true" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (multiple || selected.length === 0) && (
        <>
          <Input
            id={id}
            type="search"
            aria-label={t('pageEditor.fields.entry.search')}
            placeholder={t('pageEditor.fields.entry.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {failed ? (
            <p role="alert" className="text-sm text-destructive">
              {t('pageEditor.fields.entry.loadFailed')}
            </p>
          ) : entries && results.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('pageEditor.fields.entry.noResults')}</p>
          ) : (
            <ul className="space-y-1">
              {results.map((e) => (
                <li key={e.documentId}>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => {
                      onChange(multiple ? [...selected, e.documentId] : [e.documentId]);
                      setQuery('');
                    }}
                  >
                    <PlusIcon aria-hidden="true" />
                    <span className="truncate">{entryLabel(e, type, displayField)}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/** `b.entry(apiId)`: one entry, stored as `{ documentId }`. */
export const EntryField: CustomFieldRender<StoredEntry | null> = ({ field, name, id, value, onChange, readOnly }) => {
  const bf = field.metadata?.blockField as EntryBlockField;
  return (
    <FieldShell id={id} label={fieldLabel(field, name)}>
      <EntryPicker
        id={id}
        apiId={bf.apiId}
        displayField={bf.displayField}
        multiple={false}
        readOnly={readOnly}
        selected={value?.documentId ? [value.documentId] : []}
        onChange={(ids) => onChange(ids[0] ? { documentId: ids[0] } : null)}
      />
    </FieldShell>
  );
};
