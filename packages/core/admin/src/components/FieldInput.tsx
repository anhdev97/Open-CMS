import { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Textarea } from './ui/textarea';
import { t } from '../i18n';
import { api } from '../lib/api';
import { useFormat } from '../i18n/hooks';
import type { FieldDefinition } from '../lib/types';
import { DownloadIcon, FileIcon, XIcon } from 'lucide-react';

/** A private file owned by an entry (`GET /api/admin/content/:apiId/:documentId/files`). */
export interface EntryFile {
  id: string;
  filename: string;
  size: number | null;
  mime: string | null;
}

type AssetMeta = { mimeType: string | null; alt: string | null };
type Option = { value: string; label: string; asset?: AssetMeta };
type AssetRow = { id: string; filename: string; mimeType?: string | null; alt?: string | null };
const assetMissingAlt = (a?: AssetMeta) => !!a && (a.mimeType ?? '').startsWith('image/') && !a.alt?.trim();
const optionCache = new Map<string, Promise<Option[]>>();
// Set from `meta.uploadEnabled` of the asset list response; upload route only exists when `assets` is configured.
let assetsUploadEnabled = false;
const NONE = '__none__';
const META_KEYS = ['documentId', 'status', 'locale', 'createdAt', 'updatedAt', 'publishedAt'];

function loadOptions(field: FieldDefinition): Promise<Option[]> {
  const key =
    field.kind === 'reference' ? `ref:${field.options.target}` : field.kind === 'asset' ? 'assets' : `tax:${field.options.taxonomy}`;
  if (!optionCache.has(key)) {
    const p =
      field.kind === 'reference'
        ? api<{ data: any[] }>(`/api/admin/content/${field.options.target}?limit=100`).then((r) =>
            r.data.map((e) => {
              const title = Object.entries(e).find(([k, v]) => typeof v === 'string' && !META_KEYS.includes(k))?.[1];
              return { value: e.documentId, label: `${title ?? e.documentId}` };
            }),
          )
        : field.kind === 'asset'
          ? api<{ data: any[]; meta?: { uploadEnabled?: boolean } }>('/api/admin/assets').then((r) => {
              assetsUploadEnabled = r.meta?.uploadEnabled === true;
              return r.data.map((a: AssetRow) => ({ value: a.id, label: a.filename, asset: { mimeType: a.mimeType ?? null, alt: a.alt ?? null } }));
            })
          : api<{ data: any[] }>(`/api/admin/taxonomies/${field.options.taxonomy}/terms`).then((r) =>
              r.data.map((term) => ({ value: term.id, label: (Object.values(term.name ?? {})[0] as string) ?? term.slug })),
            );
    optionCache.set(
      key,
      p.catch(() => {
        optionCache.delete(key);
        return [];
      }),
    );
  }
  return optionCache.get(key)!;
}

function AssetTools({
  id,
  field,
  value,
  options,
  onChange,
  onReload,
  uploadEnabled,
}: {
  id: string;
  field: FieldDefinition;
  value: any;
  options: Option[];
  onChange: (v: any) => void;
  onReload: () => void;
  uploadEnabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Assets uploaded in this session that the API flagged (or not) before the cached list reloads.
  const [flagged, setFlagged] = useState<Record<string, AssetMeta>>({});
  const [alts, setAlts] = useState<Record<string, string>>({});
  const selected: string[] = field.options.multiple ? (value ?? []) : value ? [value] : [];
  const missing = selected.filter((sid) => assetMissingAlt(flagged[sid] ?? options.find((o) => o.value === sid)?.asset));
  const labelOf = (sid: string) => options.find((o) => o.value === sid)?.label ?? sid;

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await api<{ data: AssetRow; seo?: { missingAlt?: boolean } }>('/api/admin/assets/upload', { method: 'POST', body });
      optionCache.delete('assets');
      setFlagged((f) => ({
        ...f,
        [res.data.id]: { mimeType: res.data.mimeType ?? null, alt: res.seo?.missingAlt ? null : (res.data.alt ?? 'ok') },
      }));
      onChange(field.options.multiple ? [...selected, res.data.id] : res.data.id);
      onReload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveAlt = async (sid: string) => {
    const alt = (alts[sid] ?? '').trim();
    if (!alt) return;
    setError(null);
    try {
      const res = await api<{ data: AssetRow }>(`/api/admin/assets/${sid}`, { method: 'PATCH', json: { alt } });
      optionCache.delete('assets');
      setFlagged((f) => ({ ...f, [sid]: { mimeType: res.data.mimeType ?? null, alt: res.data.alt ?? alt } }));
      setAlts((a) => ({ ...a, [sid]: '' }));
      onReload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="mt-2 space-y-2">
      {uploadEnabled && (
        <div className="flex items-center gap-2">
          <Input
            id={`${id}-upload`}
            type="file"
            aria-label={t('field.assetUpload')}
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void upload(file);
            }}
          />
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {missing.map((sid) => (
        <div key={sid} className="space-y-1">
          <p role="alert" className="text-sm text-muted-foreground">
            {labelOf(sid)}: {t('field.assetMissingAlt')}
          </p>
          <div className="flex gap-2">
            <Input
              aria-label={t('field.assetAltPlaceholder')}
              placeholder={t('field.assetAltPlaceholder')}
              value={alts[sid] ?? ''}
              onChange={(e) => setAlts((a) => ({ ...a, [sid]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void saveAlt(sid);
                }
              }}
            />
            <Button type="button" variant="outline" disabled={!(alts[sid] ?? '').trim()} onClick={() => void saveAlt(sid)}>
              {t('field.assetAltSave')}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function RelationInput({ id, field, value, onChange, disabled }: { id: string; field: FieldDefinition; value: any; onChange: (v: any) => void; disabled?: boolean }) {
  const [options, setOptions] = useState<Option[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let live = true;
    loadOptions(field).then((o) => live && setOptions(o));
    return () => {
      live = false;
    };
  }, [field.kind, field.options.target, field.options.taxonomy, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const tools =
    field.kind === 'asset' && !disabled ? (
      <AssetTools id={id} field={field} value={value} options={options} onChange={onChange} onReload={() => setReloadKey((k) => k + 1)} uploadEnabled={assetsUploadEnabled} />
    ) : null;

  if (field.options.multiple) {
    const selected: string[] = value ?? [];
    const toggle = (v: string, on: boolean) => onChange(on ? [...selected, v] : selected.filter((s) => s !== v));
    return (
      <>
        <div
          id={id}
          role="group"
          aria-labelledby={`${id}-label`}
          className="max-h-44 space-y-2 overflow-y-auto rounded-md border border-input p-3"
        >
          {options.length === 0 && <p className="text-sm text-muted-foreground">{t('field.noOptions')}</p>}
          {options.map((o) => (
            <div key={o.value} className="flex items-center gap-2">
              <Checkbox id={`${id}-${o.value}`} disabled={disabled} checked={selected.includes(o.value)} onCheckedChange={(c) => toggle(o.value, c === true)} />
              <Label htmlFor={`${id}-${o.value}`} className="font-normal">
                {o.label}
              </Label>
            </div>
          ))}
        </div>
        {tools}
      </>
    );
  }
  return (
    <>
      <Select value={value ?? NONE} disabled={disabled} onValueChange={(v) => onChange(v === NONE ? null : v)}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t('content.noValue')}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {tools}
    </>
  );
}

function JsonInput({ id, value, onChange, disabled }: { id: string; value: any; onChange: (v: any) => void; disabled?: boolean }) {
  const [text, setText] = useState(value == null ? '' : JSON.stringify(value, null, 2));
  const [bad, setBad] = useState(false);
  return (
    <>
      <Textarea
        id={id}
        className="font-mono"
        disabled={disabled}
        value={text}
        aria-invalid={bad}
        aria-describedby={bad ? `${id}-error` : undefined}
        onChange={(e) => {
          setText(e.target.value);
          if (!e.target.value.trim()) {
            setBad(false);
            return onChange(null);
          }
          try {
            onChange(JSON.parse(e.target.value));
            setBad(false);
          } catch {
            setBad(true);
          }
        }}
      />
      {bad && (
        <p id={`${id}-error`} className="mt-1 text-sm text-destructive">
          {t('field.invalidJson')}
        </p>
      )}
    </>
  );
}

interface FieldInputProps {
  /** DOM id for the control; the surrounding label points at it with `htmlFor`. */
  id: string;
  field: FieldDefinition;
  value: any;
  onChange: (v: any) => void;
  /** Shown but not editable (readOnly fields, the detail page, entries locked in review). */
  disabled?: boolean;
  /**
   * Asset fields of a private type (spec §7): files upload to the type's private route and show filename, size and
   * Download; `files` holds the metadata of the files the entry already owns.
   */
  privateAssets?: { apiId: string; files: EntryFile[] };
}

export function FieldInput({ id, field, value, onChange, disabled, privateAssets }: FieldInputProps) {
  switch (field.kind) {
    case 'longText':
      return <Textarea id={id} disabled={disabled} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} />;
    case 'richText':
    case 'json':
      return <JsonInput id={id} disabled={disabled} value={value} onChange={onChange} />;
    case 'number':
      return (
        <Input
          id={id}
          disabled={disabled}
          type="number"
          step={field.options.format === 'decimal' ? 'any' : 1}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      );
    case 'boolean':
      return <Checkbox id={id} disabled={disabled} checked={!!value} onCheckedChange={(c) => onChange(c === true)} />;
    case 'date':
      return <Input id={id} disabled={disabled} type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} />;
    case 'datetime':
      return (
        <Input
          id={id}
          disabled={disabled}
          type="datetime-local"
          value={value ? new Date(value).toISOString().slice(0, 16) : ''}
          onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
        />
      );
    case 'money': {
      const v = value ?? { amount: null, currency: field.options.currency ?? '' };
      return (
        <div className="flex gap-2">
          <Input
            id={id}
            disabled={disabled}
            type="number"
            step="any"
            aria-label={t('field.amount')}
            placeholder={t('field.amount')}
            value={v.amount ?? ''}
            onChange={(e) => onChange(e.target.value === '' ? null : { ...v, amount: Number(e.target.value) })}
          />
          <Input
            className="w-24"
            disabled={disabled}
            aria-label={t('field.currency')}
            placeholder={t('field.currencyPlaceholder')}
            maxLength={3}
            value={v.currency ?? ''}
            onChange={(e) => onChange({ ...v, currency: e.target.value.toUpperCase() })}
          />
        </div>
      );
    }
    case 'asset':
      if (privateAssets) {
        return <PrivateAssetInput id={id} field={field} value={value} onChange={onChange} disabled={disabled} apiId={privateAssets.apiId} files={privateAssets.files} />;
      }
      return <RelationInput id={id} field={field} value={value} onChange={onChange} disabled={disabled} />;
    case 'reference':
    case 'taxonomy':
      return <RelationInput id={id} field={field} value={value} onChange={onChange} disabled={disabled} />;
    default:
      return <Input id={id} disabled={disabled} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} />;
  }
}

/** Human-readable file size (B / KB / MB / GB, one decimal). */
export function formatBytes(n: number | null, formatNumber: (v: number, o?: Intl.NumberFormatOptions) => string): string {
  if (n == null) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${formatNumber(v, { maximumFractionDigits: u === 0 ? 0 : 1 })} ${units[u]}`;
}

/** Opens a short-lived signed link (`POST /api/admin/assets/:id/link`) as a download. */
async function downloadPrivate(id: string, filename: string) {
  const { url } = await api<{ url: string; expiresAt: string }>(`/api/admin/assets/${id}/link`, { method: 'POST' });
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function PrivateAssetInput({
  id,
  field,
  value,
  onChange,
  disabled,
  apiId,
  files,
}: {
  id: string;
  field: FieldDefinition;
  value: any;
  onChange: (v: any) => void;
  disabled?: boolean;
  apiId: string;
  files: EntryFile[];
}) {
  const { formatNumber } = useFormat();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<EntryFile[]>([]);
  const multiple = !!field.options.multiple;
  const selected: string[] = multiple ? (value ?? []) : value ? [value] : [];
  const known = (sid: string) => uploaded.find((f) => f.id === sid) ?? files.find((f) => f.id === sid);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('field', field.name);
      const res = await api<{ data: { id: string; filename: string; size?: number | null; mimeType?: string | null } }>(
        `/api/admin/content/${apiId}/assets`,
        { method: 'POST', body },
      );
      const meta: EntryFile = { id: res.data.id, filename: res.data.filename, size: res.data.size ?? file.size, mime: res.data.mimeType ?? null };
      setUploaded((u) => [...u, meta]);
      onChange(multiple ? [...selected, meta.id] : meta.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const download = async (sid: string, filename: string) => {
    setError(null);
    try {
      await downloadPrivate(sid, filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('content.downloadFailed'));
    }
  };

  return (
    <div id={id} role="group" aria-labelledby={`${id}-label`} className="space-y-2">
      {selected.length === 0 && <p className="text-sm text-muted-foreground">{t('content.noFile')}</p>}
      {selected.length > 0 && (
        <ul className="divide-y rounded-md border">
          {selected.map((sid) => {
            const f = known(sid);
            const name = f?.filename ?? sid;
            return (
              <li key={sid} className="flex items-center gap-3 px-3 py-2 text-sm">
                <FileIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{name}</span>
                {f?.size != null && <span className="shrink-0 text-muted-foreground">{formatBytes(f.size, formatNumber)}</span>}
                <Button type="button" variant="outline" size="sm" aria-label={t('content.downloadFile', { name })} onClick={() => void download(sid, name)}>
                  <DownloadIcon aria-hidden="true" />
                  {t('content.download')}
                </Button>
                {!disabled && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('content.removeFile', { name })}
                    onClick={() => onChange(multiple ? selected.filter((s) => s !== sid) : null)}
                  >
                    <XIcon aria-hidden="true" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!disabled && (multiple || selected.length === 0) && (
        <Input
          id={`${id}-upload`}
          type="file"
          aria-label={t('content.uploadFile')}
          accept={Array.isArray(field.options.accept) ? field.options.accept.join(',') : undefined}
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void upload(file);
          }}
        />
      )}
      {busy && <p className="text-sm text-muted-foreground">{t('content.uploading')}</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
