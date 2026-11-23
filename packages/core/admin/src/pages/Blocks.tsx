import { BlocksIcon, CheckIcon, CopyIcon, FileCodeIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { localizedText } from '@opencloudcms/schema';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { ErrorAlert } from '../components/ErrorAlert';
import { PageHeader } from '../components/PageHeader';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { t } from '../i18n';
import { useLocale } from '../i18n/hooks';
import {
  blockActions,
  blockErrorMessageKey,
  COMPOSED_INDEX_IMPORT,
  COMPOSED_INDEX_SPREAD,
  deleteBlock,
  ejectBlock,
  listBlocks,
  type BlockListItem,
  type BlocksResponse,
  type EjectResult,
} from '../lib/blocks';
import { Link, useAdminNavigate } from '../lib/nav';

type Outcome = { kind: 'deleted'; name: string; files: string[] } | ({ kind: 'ejected'; name: string } & EjectResult);

function CopyLine({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-2">
      <code className="min-w-0 flex-1 break-all whitespace-pre-wrap font-mono text-sm">{text}</code>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          });
        }}
      >
        {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
      </Button>
    </div>
  );
}

export function Blocks() {
  const locale = useLocale();
  const navigate = useAdminNavigate();
  const [state, setState] = useState<BlocksResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [deleting, setDeleting] = useState<BlockListItem | null>(null);
  const [ejecting, setEjecting] = useState<BlockListItem | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const reload = useCallback(() => {
    listBlocks().then(setState, (e: unknown) => setError(e instanceof Error ? e : new Error(String(e))));
  }, []);
  useEffect(reload, [reload]);

  const fail = (e: unknown) => {
    const key = blockErrorMessageKey(e);
    setError(key ? new Error(t(key)) : e instanceof Error ? e : new Error(String(e)));
  };

  const doDelete = async (b: BlockListItem) => {
    setError(null);
    try {
      const r = await deleteBlock(b.name, { force: b.usage > 0 });
      setOutcome({ kind: 'deleted', name: b.name, files: r.files });
      toast.success(t('blocks.deleted'));
      reload();
    } catch (e) {
      fail(e);
    }
  };

  const doEject = async (b: BlockListItem) => {
    setError(null);
    try {
      const r = await ejectBlock(b.name);
      setOutcome({ kind: 'ejected', name: b.name, ...r });
      toast.success(t('blocks.ejected'));
      reload();
    } catch (e) {
      fail(e);
    }
  };

  const editable = state?.editable ?? false;
  const sourceLabel = (s: BlockListItem['source']) => t(`blocks.source.${s}`);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('blocks.title')}
        description={t('blocks.description')}
        actions={
          editable ? (
            <Button size="sm" onClick={() => navigate('/settings/blocks/new')}>
              <PlusIcon aria-hidden="true" />
              {t('blocks.new')}
            </Button>
          ) : undefined
        }
      />

      {state && !editable && (
        <Alert variant="warning">
          <AlertDescription>{t('blocks.readOnly')}</AlertDescription>
        </Alert>
      )}
      <ErrorAlert error={error} />

      {state && !state.composedIndexWired && (
        <Alert variant="warning">
          <AlertTitle>{t('blocks.wiring.title')}</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{t('blocks.wiring.description')}</p>
            <CopyLine text={COMPOSED_INDEX_IMPORT} label={t('blocks.copyImport')} />
            <CopyLine text={COMPOSED_INDEX_SPREAD} label={t('blocks.copySpread')} />
            <p>{t('blocks.wiring.hint')}</p>
          </AlertDescription>
        </Alert>
      )}

      {state?.loadErrors.map((e) => (
        <Alert key={e.file} variant="destructive">
          <AlertTitle>{t('blocks.loadError', { file: e.file })}</AlertTitle>
          <AlertDescription>{e.message}</AlertDescription>
        </Alert>
      ))}

      {outcome?.kind === 'ejected' && (
        <Card>
          <CardContent className="space-y-3">
            <Alert variant="success">
              <AlertTitle>{t('blocks.ejectedTitle', { name: outcome.name })}</AlertTitle>
              <AlertDescription>{t('blocks.ejectedDescription', { file: outcome.file })}</AlertDescription>
            </Alert>
            <Alert variant="warning">
              <AlertDescription className="space-y-2">
                <p className="font-medium">{t('blocks.ejectedAddLine')}</p>
                <CopyLine text={outcome.importLine} label={t('blocks.copyImport')} />
                <p>{t('blocks.ejectedRestartNote', { name: outcome.name })}</p>
              </AlertDescription>
            </Alert>
            <p className="text-sm text-muted-foreground">{t('builder.commitFiles')}</p>
            <ul className="space-y-1 font-mono text-xs">
              {outcome.files.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {outcome?.kind === 'deleted' && (
        <Card>
          <CardContent className="space-y-3">
            <Alert variant="success">
              <AlertDescription>{t('blocks.deletedDescription', { name: outcome.name })}</AlertDescription>
            </Alert>
            <p className="text-sm text-muted-foreground">{t('builder.commitFiles')}</p>
            <ul className="space-y-1 font-mono text-xs">
              {outcome.files.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card className="py-0">
        <CardContent className="px-0">
          {state === null ? (
            <div className="space-y-2 p-4" aria-hidden="true">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : state.data.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={BlocksIcon}
                title={t('blocks.emptyTitle')}
                description={t('blocks.emptyDescription')}
                action={
                  editable ? (
                    <Button size="sm" onClick={() => navigate('/settings/blocks/new')}>
                      {t('blocks.new')}
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('blocks.labelColumn')}</TableHead>
                  <TableHead>{t('blocks.nameColumn')}</TableHead>
                  <TableHead>{t('blocks.categoryColumn')}</TableHead>
                  <TableHead>{t('blocks.sourceColumn')}</TableHead>
                  <TableHead className="text-right">{t('blocks.usageColumn')}</TableHead>
                  <TableHead className="text-right">{t('blocks.actionsColumn')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.data.map((b) => {
                  const label = localizedText(b.label, locale, b.name);
                  const actions = blockActions(b.source, editable);
                  return (
                    <TableRow key={b.name}>
                      <TableCell>
                        {actions.includes('edit') ? (
                          <Link to={`/settings/blocks/${encodeURIComponent(b.name)}`} className="font-medium underline-offset-4 hover:underline">
                            {label}
                          </Link>
                        ) : (
                          <span className="font-medium">{label}</span>
                        )}
                        {b.problems.length > 0 && (
                          <div className="mt-1 space-y-1">
                            <Badge variant="warning">{t('blocks.problems', { count: b.problems.length })}</Badge>
                            <ul className="list-disc pl-4 text-xs text-muted-foreground">
                              {b.problems.map((p) => (
                                <li key={p}>{p}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-muted-foreground">{b.name}</TableCell>
                      <TableCell className="text-muted-foreground">{b.category ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant={b.source === 'composed' ? 'default' : 'secondary'}>{sourceLabel(b.source)}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{b.usage}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {actions.includes('edit') && (
                            <Button variant="ghost" size="icon" aria-label={t('blocks.editAria', { name: label })} onClick={() => navigate(`/settings/blocks/${encodeURIComponent(b.name)}`)}>
                              <PencilIcon aria-hidden="true" />
                            </Button>
                          )}
                          {actions.includes('eject') && (
                            <Button variant="ghost" size="icon" aria-label={t('blocks.ejectAria', { name: label })} onClick={() => setEjecting(b)}>
                              <FileCodeIcon aria-hidden="true" />
                            </Button>
                          )}
                          {actions.includes('delete') && (
                            <Button variant="ghost" size="icon" aria-label={t('blocks.deleteAria', { name: label })} onClick={() => setDeleting(b)}>
                              <Trash2Icon aria-hidden="true" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('blocks.deleteTitle')}
        description={
          deleting && deleting.usage > 0
            ? t('blocks.deleteInUse', { name: deleting.name, count: deleting.usage })
            : t('blocks.deleteDescription', { name: deleting?.name ?? '' })
        }
        confirmLabel={t('common.delete')}
        destructive
        onConfirm={() => deleting && void doDelete(deleting)}
      />
      <ConfirmDialog
        open={!!ejecting}
        onOpenChange={(o) => !o && setEjecting(null)}
        title={t('blocks.ejectTitle')}
        description={t('blocks.ejectDescription', { name: ejecting?.name ?? '' })}
        confirmLabel={t('blocks.ejectConfirm')}
        onConfirm={() => ejecting && void doEject(ejecting)}
      />
    </div>
  );
}
