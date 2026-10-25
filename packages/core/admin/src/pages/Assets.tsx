import {
  ChevronRightIcon,
  FileIcon,
  FolderIcon,
  FolderPlusIcon,
  ImageIcon,
  MoreHorizontalIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { ErrorAlert } from '../components/ErrorAlert';
import { PageHeader } from '../components/PageHeader';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Checkbox } from '../components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Skeleton } from '../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { t } from '../i18n';
import { useFormat } from '../i18n/hooks';
import { api } from '../lib/api';
import { useCan } from '../lib/can';
import { cn } from '../lib/utils';

type VariantInfo = { url: string };
type AssetVariants = { original?: VariantInfo; thumb?: VariantInfo };

export type AssetRow = {
  id: string;
  filename: string;
  url: string;
  mimeType?: string | null;
  alt?: string | null;
  width?: number | null;
  height?: number | null;
  size?: number | null;
  folderId?: string | null;
  variants?: AssetVariants | null;
  createdAt?: string;
};

export type FolderRow = {
  id: string;
  parentId: string | null;
  slug: string;
  name: string;
};

type ListResponse = { data: AssetRow[]; meta?: { uploadEnabled?: boolean } };

const LIST_LIMIT = 200;
/** Selection: all assets, root only, or a folder id. */
type FolderSel = 'all' | 'root' | string;

type TreeNode = FolderRow & { children: TreeNode[] };

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

function formatBytes(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function buildTree(folders: FolderRow[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  for (const f of folders) map.set(f.id, { ...f, children: [] });
  const roots: TreeNode[] = [];
  for (const f of folders) {
    const node = map.get(f.id)!;
    if (f.parentId && map.has(f.parentId)) map.get(f.parentId)!.children.push(node);
    else roots.push(node);
  }
  const sortRec = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    for (const n of nodes) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

function flattenFolders(nodes: TreeNode[], depth = 0): { folder: FolderRow; depth: number }[] {
  const out: { folder: FolderRow; depth: number }[] = [];
  for (const n of nodes) {
    out.push({ folder: n, depth });
    out.push(...flattenFolders(n.children, depth + 1));
  }
  return out;
}

export function Assets() {
  const can = useCan();
  const canUpdate = can('content.update');
  const { formatDateTime } = useFormat();
  const fileRef = useRef<HTMLInputElement>(null);

  const [folders, setFolders] = useState<FolderRow[] | null>(null);
  const [items, setItems] = useState<AssetRow[] | null>(null);
  const [folderSel, setFolderSel] = useState<FolderSel>('all');
  const [uploadEnabled, setUploadEnabled] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dropTarget, setDropTarget] = useState<FolderSel | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [editAlt, setEditAlt] = useState<AssetRow | null>(null);
  const [altDraft, setAltDraft] = useState('');
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderParent, setNewFolderParent] = useState<string | 'root'>('root');
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<string | 'root'>('root');
  const [pendingDelete, setPendingDelete] = useState<'assets' | FolderRow | null>(null);

  const tree = useMemo(() => buildTree(folders ?? []), [folders]);
  const flatFolders = useMemo(() => flattenFolders(tree), [tree]);

  const loadFolders = useCallback(async () => {
    const r = await api<{ data: FolderRow[] }>('/api/admin/asset-folders');
    setFolders(r.data);
  }, []);

  const loadAssets = useCallback(async () => {
    const q =
      folderSel === 'all' ? '' : folderSel === 'root' ? '&folderId=root' : `&folderId=${encodeURIComponent(folderSel)}`;
    const r = await api<ListResponse>(`/api/admin/assets?limit=${LIST_LIMIT}${q}`);
    setItems(r.data);
    setUploadEnabled(r.meta?.uploadEnabled === true);
    setSelected(new Set());
  }, [folderSel]);

  useEffect(() => {
    setError(null);
    loadFolders().catch((e) => {
      setError(e instanceof Error ? e : new Error(String(e)));
      setFolders([]);
    });
  }, [loadFolders]);

  useEffect(() => {
    setError(null);
    loadAssets().catch((e) => {
      setError(e instanceof Error ? e : new Error(String(e)));
      setItems([]);
    });
  }, [loadAssets]);

  const onUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append('file', file);
      if (folderSel !== 'all' && folderSel !== 'root') body.append('folderId', folderSel);
      await api('/api/admin/assets/upload', { method: 'POST', body });
      toast.success(t('assets.uploadedToast'));
      await loadAssets();
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const saveAlt = async () => {
    if (!editAlt) return;
    setBusy(true);
    try {
      await api(`/api/admin/assets/${editAlt.id}`, { method: 'PATCH', json: { alt: altDraft } });
      toast.success(t('assets.altSavedToast'));
      setEditAlt(null);
      await loadAssets();
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBusy(false);
    }
  };

  const createFolder = async () => {
    setBusy(true);
    try {
      await api('/api/admin/asset-folders', {
        method: 'POST',
        json: { name: newFolderName.trim(), parentId: newFolderParent === 'root' ? null : newFolderParent },
      });
      toast.success(t('assets.folderCreatedToast'));
      setNewFolderOpen(false);
      setNewFolderName('');
      await loadFolders();
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBusy(false);
    }
  };

  const moveSelected = async (target: string | 'root') => {
    const ids = [...selected];
    if (!ids.length) return;
    setBusy(true);
    try {
      await api('/api/admin/assets/bulk', {
        method: 'POST',
        json: { action: 'move', ids, folderId: target === 'root' ? null : target },
      });
      toast.success(t('assets.movedToast'));
      setMoveOpen(false);
      await loadAssets();
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    setBusy(true);
    try {
      if (target === 'assets') {
        await api('/api/admin/assets/bulk', { method: 'POST', json: { action: 'delete', ids: [...selected] } });
        toast.success(t('assets.deletedToast'));
        await loadAssets();
      } else {
        await api(`/api/admin/asset-folders/${target.id}`, { method: 'DELETE' });
        toast.success(t('assets.folderDeletedToast'));
        if (folderSel === target.id) setFolderSel('all');
        await loadFolders();
        await loadAssets();
      }
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBusy(false);
    }
  };

  const dropOnFolder = async (target: FolderSel, assetIds: string[], folderId?: string) => {
    if (!canUpdate) return;
    setDropTarget(null);
    if (folderId) {
      if (target === 'all') return;
      const parentId = target === 'root' ? null : target;
      if (parentId === folderId) return;
      setBusy(true);
      try {
        await api(`/api/admin/asset-folders/${folderId}`, { method: 'PATCH', json: { parentId } });
        toast.success(t('assets.folderMovedToast'));
        await loadFolders();
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!assetIds.length || target === 'all') return;
    setBusy(true);
    try {
      await api('/api/admin/assets/bulk', {
        method: 'POST',
        json: { action: 'move', ids: assetIds, folderId: target === 'root' ? null : target },
      });
      toast.success(t('assets.movedToast'));
      await loadAssets();
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBusy(false);
    }
  };

  const onDragStartAssets = (e: DragEvent, id: string) => {
    const ids = selected.has(id) && selected.size > 0 ? [...selected] : [id];
    e.dataTransfer.setData('application/x-opencloudcms-assets', JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDragStartFolder = (e: DragEvent, id: string) => {
    e.dataTransfer.setData('application/x-opencloudcms-folder', id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDragOverNav = (e: DragEvent, target: FolderSel) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget(target);
  };

  const onDropNav = (e: DragEvent, target: FolderSel) => {
    e.preventDefault();
    const folderId = e.dataTransfer.getData('application/x-opencloudcms-folder');
    const raw = e.dataTransfer.getData('application/x-opencloudcms-assets');
    let assetIds: string[] = [];
    try {
      assetIds = raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      assetIds = [];
    }
    void dropOnFolder(target, assetIds, folderId || undefined);
  };

  const toggleExpand = (id: string) => {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelect = (id: string, on: boolean) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const allChecked = !!items?.length && items.every((a) => selected.has(a.id));
  const someChecked = !!items?.some((a) => selected.has(a.id));

  const renderTree = (nodes: TreeNode[], depth: number) =>
    nodes.map((n) => {
      const open = expanded.has(n.id) || folderSel === n.id;
      const active = folderSel === n.id;
      return (
        <div key={n.id}>
          <div
            className={cn(
              'group flex items-center gap-0.5 rounded-md pr-1',
              active && 'bg-accent text-accent-foreground',
              dropTarget === n.id && 'ring-2 ring-ring',
            )}
            onDragOver={(e) => onDragOverNav(e, n.id)}
            onDragLeave={() => setDropTarget((t) => (t === n.id ? null : t))}
            onDrop={(e) => onDropNav(e, n.id)}
          >
            <button
              type="button"
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
              aria-label={open ? t('assets.collapseFolder') : t('assets.expandFolder')}
              onClick={() => toggleExpand(n.id)}
            >
              <ChevronRightIcon className={cn('size-4 transition-transform', open && 'rotate-90', !n.children.length && 'opacity-0')} />
            </button>
            <button
              type="button"
              draggable={canUpdate}
              onDragStart={(e) => onDragStartFolder(e, n.id)}
              onClick={() => setFolderSel(n.id)}
              className="flex min-w-0 flex-1 items-center gap-2 truncate rounded-md px-1 py-1.5 text-left text-sm hover:bg-muted/80"
              style={{ paddingLeft: depth ? undefined : undefined }}
            >
              <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate">{n.name}</span>
            </button>
            {canUpdate && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100" aria-label={t('assets.folderMenu')}>
                    <MoreHorizontalIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => {
                      setNewFolderParent(n.id);
                      setNewFolderName('');
                      setNewFolderOpen(true);
                    }}
                  >
                    {t('assets.newSubfolder')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => setPendingDelete(n)}>
                    {t('assets.deleteFolder')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          {open && n.children.length > 0 && <div className="ml-3 border-l border-border pl-1">{renderTree(n.children, depth + 1)}</div>}
        </div>
      );
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('assets.title')}
        description={t('assets.description')}
        actions={
          canUpdate && (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setNewFolderParent(folderSel !== 'all' && folderSel !== 'root' ? folderSel : 'root');
                  setNewFolderName('');
                  setNewFolderOpen(true);
                }}
              >
                <FolderPlusIcon aria-hidden="true" />
                {t('assets.newFolder')}
              </Button>
              {uploadEnabled && (
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
              )}
            </div>
          )
        }
      />

      {canUpdate && !uploadEnabled && items !== null && (
        <Alert>
          <AlertDescription>{t('assets.uploadDisabled')}</AlertDescription>
        </Alert>
      )}
      <ErrorAlert error={error} />

      {selected.size > 0 && canUpdate && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
          <span className="text-sm text-muted-foreground">{t('assets.selectedCount', { count: selected.size })}</span>
          <Button type="button" size="sm" variant="secondary" onClick={() => { setMoveTarget('root'); setMoveOpen(true); }}>
            {t('assets.move')}
          </Button>
          <Button type="button" size="sm" variant="destructive" onClick={() => setPendingDelete('assets')}>
            <Trash2Icon aria-hidden="true" />
            {t('assets.delete')}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            {t('assets.clearSelection')}
          </Button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <Card className="h-fit py-2">
          <CardContent className="space-y-1 px-2">
            <p className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('assets.folders')}</p>
            <button
              type="button"
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                folderSel === 'all' ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
              )}
              onClick={() => setFolderSel('all')}
            >
              <ImageIcon className="size-4 text-muted-foreground" aria-hidden="true" />
              {t('assets.allAssets')}
            </button>
            <button
              type="button"
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                folderSel === 'root' ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
                dropTarget === 'root' && 'ring-2 ring-ring',
              )}
              onClick={() => setFolderSel('root')}
              onDragOver={(e) => onDragOverNav(e, 'root')}
              onDragLeave={() => setDropTarget((t) => (t === 'root' ? null : t))}
              onDrop={(e) => onDropNav(e, 'root')}
            >
              <FolderIcon className="size-4 text-muted-foreground" aria-hidden="true" />
              {t('assets.rootFolder')}
            </button>
            {folders === null ? <Skeleton className="h-20 w-full" /> : renderTree(tree, 0)}
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-4">
          {items === null && !error && (
            <div className="space-y-2" aria-hidden="true">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}

          {items?.length === 0 && (
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
            <Card className="py-0">
              <CardContent className="px-0">
                <Table aria-label={t('assets.listLabel')}>
                  <TableHeader>
                    <TableRow>
                      {canUpdate && (
                        <TableHead className="w-10">
                          <Checkbox
                            checked={allChecked ? true : someChecked ? 'indeterminate' : false}
                            onCheckedChange={(c) => {
                              if (c === true) setSelected(new Set(items.map((a) => a.id)));
                              else setSelected(new Set());
                            }}
                            aria-label={t('assets.selectAll')}
                          />
                        </TableHead>
                      )}
                      <TableHead className="w-14">{t('assets.colPreview')}</TableHead>
                      <TableHead>{t('assets.colFilename')}</TableHead>
                      <TableHead className="hidden md:table-cell">{t('assets.colType')}</TableHead>
                      <TableHead className="hidden sm:table-cell">{t('assets.colSize')}</TableHead>
                      <TableHead>{t('assets.colAlt')}</TableHead>
                      <TableHead className="hidden lg:table-cell">{t('assets.colCreated')}</TableHead>
                      {canUpdate && <TableHead className="w-12" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((a) => {
                      const preview = previewUrl(a);
                      return (
                        <TableRow
                          key={a.id}
                          draggable={canUpdate}
                          onDragStart={(e) => onDragStartAssets(e, a.id)}
                          className={cn(selected.has(a.id) && 'bg-muted/50')}
                        >
                          {canUpdate && (
                            <TableCell>
                              <Checkbox
                                checked={selected.has(a.id)}
                                onCheckedChange={(c) => toggleSelect(a.id, c === true)}
                                aria-label={t('assets.selectRow', { filename: a.filename })}
                              />
                            </TableCell>
                          )}
                          <TableCell>
                            <div className="flex size-10 items-center justify-center overflow-hidden rounded-md bg-muted">
                              {preview ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={preview} alt="" className="size-full object-cover" />
                              ) : (
                                <FileIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="max-w-[12rem] truncate font-medium" title={a.filename}>
                            {a.filename}
                          </TableCell>
                          <TableCell className="hidden text-muted-foreground md:table-cell">{a.mimeType ?? '—'}</TableCell>
                          <TableCell className="hidden text-muted-foreground sm:table-cell">{formatBytes(a.size)}</TableCell>
                          <TableCell>
                            {missingAlt(a) ? (
                              <Badge variant="outline">{t('assets.missingAltBadge')}</Badge>
                            ) : (
                              <span className="line-clamp-1 text-sm text-muted-foreground">{a.alt || '—'}</span>
                            )}
                          </TableCell>
                          <TableCell className="hidden text-muted-foreground lg:table-cell">
                            {a.createdAt ? formatDateTime(a.createdAt) : '—'}
                          </TableCell>
                          {canUpdate && (
                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon-sm" aria-label={t('assets.rowMenu', { filename: a.filename })}>
                                    <MoreHorizontalIcon />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setEditAlt(a);
                                      setAltDraft(a.alt ?? '');
                                    }}
                                  >
                                    {t('assets.editAlt')}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setSelected(new Set([a.id]));
                                      setMoveTarget(a.folderId ?? 'root');
                                      setMoveOpen(true);
                                    }}
                                  >
                                    {t('assets.move')}
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    variant="destructive"
                                    onClick={() => {
                                      setSelected(new Set([a.id]));
                                      setPendingDelete('assets');
                                    }}
                                  >
                                    {t('assets.delete')}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={!!editAlt} onOpenChange={(o) => !o && setEditAlt(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('assets.editAltTitle')}</DialogTitle>
            <DialogDescription>{editAlt?.filename}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="asset-alt">{t('assets.altLabel')}</Label>
            <Input id="asset-alt" value={altDraft} onChange={(e) => setAltDraft(e.target.value)} placeholder={t('assets.altPlaceholder')} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditAlt(null)}>
              {t('common.cancel')}
            </Button>
            <Button type="button" disabled={busy} onClick={() => void saveAlt()}>
              {t('assets.saveAlt')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('assets.newFolderTitle')}</DialogTitle>
            <DialogDescription>{t('assets.newFolderDescription')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="folder-name">{t('assets.folderName')}</Label>
              <Input id="folder-name" value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} autoFocus />
            </div>
            <div className="grid gap-2">
              <Label>{t('assets.parentFolder')}</Label>
              <Select value={newFolderParent} onValueChange={(v) => setNewFolderParent(v as string | 'root')}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="root">{t('assets.rootFolder')}</SelectItem>
                  {flatFolders.map(({ folder, depth }) => (
                    <SelectItem key={folder.id} value={folder.id}>
                      {'\u00A0'.repeat(depth * 2)}
                      {folder.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setNewFolderOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="button" disabled={busy || !newFolderName.trim()} onClick={() => void createFolder()}>
              {t('assets.createFolder')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('assets.moveTitle')}</DialogTitle>
            <DialogDescription>{t('assets.moveDescription', { count: selected.size })}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label>{t('assets.targetFolder')}</Label>
            <Select value={moveTarget} onValueChange={(v) => setMoveTarget(v as string | 'root')}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="root">{t('assets.rootFolder')}</SelectItem>
                {flatFolders.map(({ folder, depth }) => (
                  <SelectItem key={folder.id} value={folder.id}>
                    {'\u00A0'.repeat(depth * 2)}
                    {folder.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMoveOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="button" disabled={busy} onClick={() => void moveSelected(moveTarget)}>
              {t('assets.move')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={
          pendingDelete === 'assets'
            ? t('assets.deleteTitle')
            : t('assets.deleteFolderTitle')
        }
        description={
          pendingDelete === 'assets'
            ? t('assets.deleteBulkDescription', { count: selected.size })
            : t('assets.deleteFolderDescription', {
                name: typeof pendingDelete === 'object' && pendingDelete ? pendingDelete.name : '',
              })
        }
        confirmLabel={t('assets.delete')}
        destructive
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
