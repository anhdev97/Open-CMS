import { FileIcon, ImageIcon, UploadIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { ErrorAlert } from '../components/ErrorAlert';
import { PageHeader } from '../components/PageHeader';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Skeleton } from '../components/ui/skeleton';
import { t } from '../i18n';
import { api } from '../lib/api';
import { useCan } from '../lib/can';

type VariantInfo = { url: string; key?: string; width?: number; height?: number; mimeType?: string };
type AssetVariants = { original?: VariantInfo; thumb?: VariantInfo; medium?: VariantInfo; large?: VariantInfo };

export type AssetRow = {
  id: string;
  filename: string;
  url: string;
  mimeType?: string | null;
  alt?: string | null;
  width?: number | null;
  height?: number | null;
  size?: number | null;
  variants?: AssetVariants | null;
  createdAt?: string;
};

type ListResponse = { data: AssetRow[]; meta?: { uploadEnabled?: boolean } };

const LIST_LIMIT = 200;

function isImage(mime?: string | null) {
  return !!mime && mime.startsWith('image/');
}

function previewUrl(a: AssetRow): string | null {
  if (!isImage(a.mimeType)) return null;
  return a.variants?.thumb?.url ?? a.variants?.original?.url ?? a.url;
}

function missingAlt(a: AssetRow) {
  return isImage(a.mimeType) && !a.alt?.trim();
}

function AssetCard({
  asset,
  canUpdate,
  busyId,
  onSaveAlt,
  onDelete,
}: {
  asset: AssetRow;
  canUpdate: boolean;
  busyId: string | null;
  onSaveAlt: (id: string, alt: string) => Promise<void>;
  onDelete: (asset: AssetRow) => void;
}) {
  const [alt, setAlt] = useState(asset.alt ?? '');
  useEffect(() => setAlt(asset.alt ?? ''), [asset.alt, asset.id]);
  const preview = previewUrl(asset);
  const dirty = alt !== (asset.alt ?? '');
  const busy = busyId === asset.id;

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex gap-3">
        <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- admin preview of CMS-hosted media
            <img src={preview} alt={asset.alt?.trim() || asset.filename} className="size-full object-cover" />
          ) : (
            <FileIcon className="size-8 text-muted-foreground" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate text-sm font-medium" title={asset.filename}>
            {asset.filename}
          </p>
          <p className="truncate text-xs text-muted-foreground">{asset.mimeType ?? '—'}</p>
          {asset.width != null && asset.height != null && (
            <p className="text-xs text-muted-foreground">
              {asset.width}×{asset.height}
            </p>
          )}
          {missingAlt(asset) && (
            <p className="text-xs text-amber-700 dark:text-amber-400" role="status">
              {t('assets.missingAlt')}
            </p>
          )}
        </div>
      </div>
      {canUpdate && (
        <div className="space-y-2">
          <Label htmlFor={`alt-${asset.id}`}>{t('assets.altLabel')}</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id={`alt-${asset.id}`}
              value={alt}
              placeholder={t('assets.altPlaceholder')}
              onChange={(e) => setAlt(e.target.value)}
              disabled={busy}
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy || !dirty}
              onClick={() => void onSaveAlt(asset.id, alt)}
            >
              {t('assets.saveAlt')}
            </Button>
            <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => onDelete(asset)}>
              {t('assets.delete')}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

export function Assets() {
  const can = useCan();
  const canUpdate = can('content.update');
  const fileRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<AssetRow[] | null>(null);
  const [uploadEnabled, setUploadEnabled] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AssetRow | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api<ListResponse>(`/api/admin/assets?limit=${LIST_LIMIT}`);
      setItems(r.data);
      setUploadEnabled(r.meta?.uploadEnabled === true);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append('file', file);
      await api<{ data: AssetRow }>('/api/admin/assets/upload', { method: 'POST', body });
      toast.success(t('assets.uploadedToast'));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onSaveAlt = async (id: string, alt: string) => {
    setBusyId(id);
    setError(null);
    try {
      const r = await api<{ data: AssetRow }>(`/api/admin/assets/${id}`, { method: 'PATCH', json: { alt } });
      setItems((cur) => (cur ? cur.map((a) => (a.id === id ? r.data : a)) : cur));
      toast.success(t('assets.altSavedToast'));
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBusyId(null);
    }
  };

  const onConfirmDelete = async () => {
    const target = pendingDelete;
    if (!target) return;
    setPendingDelete(null);
    setBusyId(target.id);
    setError(null);
    try {
      await api(`/api/admin/assets/${target.id}`, { method: 'DELETE' });
      setItems((cur) => (cur ? cur.filter((a) => a.id !== target.id) : cur));
      toast.success(t('assets.deletedToast'));
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('assets.title')}
        description={t('assets.description')}
        actions={
          canUpdate &&
          uploadEnabled && (
            <>
              <input
                ref={fileRef}
                type="file"
                className="sr-only"
                id="assets-page-upload"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onUpload(file);
                }}
              />
              <Button asChild size="sm" disabled={uploading}>
                <label htmlFor="assets-page-upload" className={uploading ? 'pointer-events-none opacity-50' : 'cursor-pointer'}>
                  <UploadIcon aria-hidden="true" />
                  {uploading ? t('assets.uploading') : t('assets.upload')}
                </label>
              </Button>
            </>
          )
        }
      />
      {canUpdate && !uploadEnabled && items !== null && (
        <Alert>
          <AlertDescription>{t('assets.uploadDisabled')}</AlertDescription>
        </Alert>
      )}
      <ErrorAlert error={error} />
      {items === null && !error && <Skeleton className="h-40 w-full" aria-hidden="true" />}
      {items && items.length === 0 && !error && (
        <EmptyState
          icon={ImageIcon}
          title={t('assets.emptyTitle')}
          description={t('assets.emptyDescription')}
          action={
            canUpdate &&
            uploadEnabled && (
              <Button asChild size="sm">
                <label htmlFor="assets-page-upload" className="cursor-pointer">
                  <UploadIcon aria-hidden="true" />
                  {t('assets.upload')}
                </label>
              </Button>
            )
          }
        />
      )}
      {items && items.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label={t('assets.listLabel')}>
          {items.map((a) => (
            <AssetCard
              key={a.id}
              asset={a}
              canUpdate={canUpdate}
              busyId={busyId}
              onSaveAlt={onSaveAlt}
              onDelete={setPendingDelete}
            />
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={t('assets.deleteTitle')}
        description={t('assets.deleteDescription', { filename: pendingDelete?.filename ?? '' })}
        confirmLabel={t('assets.delete')}
        destructive
        onConfirm={() => void onConfirmDelete()}
      />
    </div>
  );
}
