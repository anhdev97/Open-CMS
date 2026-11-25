import { PencilIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '../../auth/AuthContext';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { t } from '../../i18n';
import { api } from '../../lib/api';
import { entryActions, formLocked, type EntryAction } from '../../lib/entry-actions';
import { Link } from '../../lib/nav';
import type { ContentTypeDefinition } from '../../lib/types';
import { workflowError, type Entry } from './useEntry';

/** Workflow buttons a private entry never shows (it is never published or reviewed; API 409 `private_type`). */
const PUBLISHING: EntryAction[] = ['publish', 'submit', 'withdraw', 'approve', 'reject', 'unpublish'];

/** What the detail page offers for an entry, from the user's permissions and the type's `review` and `private`. */
export function detailActions(
  def: ContentTypeDefinition,
  entry: Entry,
  user: { id: string; permissions: readonly string[] },
): { workflow: EntryAction[]; edit: boolean; remove: boolean; locked: boolean } {
  const input = {
    review: !!def.review && !def.private,
    workflow: entry.workflow ?? null,
    published: !!entry.publishedAt,
    permissions: user.permissions,
    userId: user.id,
  };
  const all = entryActions(input);
  const locked = formLocked(input);
  return {
    workflow: def.private ? [] : all.filter((a) => PUBLISHING.includes(a)),
    edit: all.includes('save') && !locked && user.permissions.includes('content.update'),
    remove: user.permissions.includes('content.delete'),
    locked,
  };
}

interface Props {
  def: ContentTypeDefinition;
  entry: Entry;
  editTo: string;
  /** After a workflow action succeeded (the page reloads the entry). */
  onChanged: () => Promise<void> | void;
  onDeleted: () => void;
  onError: (e: Error | null) => void;
}

/** Edit / Publish / Submit / Approve / Reject (with note) / Withdraw / Unpublish / Delete on the detail page. */
export function ReviewActions({ def, entry, editTo, onChanged, onDeleted, onError }: Props) {
  const { user } = useAuth();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const { workflow, edit, remove } = detailActions(def, entry, user);
  const base = `/api/admin/content/${def.apiId}/${entry.documentId}`;

  const run = async (fn: () => Promise<unknown>, ok: string, after: () => Promise<void> | void = onChanged) => {
    onError(null);
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      await after();
    } catch (e) {
      onError(workflowError(e));
    } finally {
      setBusy(false);
    }
  };
  const post = (action: string, ok: string) => run(() => api(`${base}/${action}`, { method: 'POST' }), ok);

  const LABEL: Record<Exclude<EntryAction, 'save'>, [string, string]> = {
    publish: ['content.publish', 'content.published'],
    submit: ['content.submit', 'content.submitted'],
    approve: ['content.approve', 'content.approved'],
    reject: ['content.reject', 'content.rejected'],
    withdraw: ['content.withdraw', 'content.withdrawn'],
    unpublish: ['content.unpublish', 'content.unpublished'],
  };

  return (
    <>
      {edit && (
        <Button asChild size="sm">
          <Link to={editTo}>
            <PencilIcon aria-hidden="true" />
            {t('content.edit')}
          </Link>
        </Button>
      )}
      {workflow.map((a) => {
        if (a === 'save') return null;
        const [label, ok] = LABEL[a];
        return (
          <Button key={a} size="sm" variant="outline" disabled={busy} onClick={() => (a === 'reject' ? setRejecting(true) : void post(a, t(ok)))}>
            {t(label)}
          </Button>
        );
      })}
      {remove && (
        <Button size="sm" variant="destructive" disabled={busy} onClick={() => setConfirmDelete(true)}>
          {t('content.delete')}
        </Button>
      )}

      <Dialog
        open={rejecting}
        onOpenChange={(o) => {
          setRejecting(o);
          if (!o) setNote('');
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('content.rejectTitle')}</DialogTitle>
            <DialogDescription>{t('content.rejectDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-note">{t('content.rejectNote')}</Label>
            <Textarea id="reject-note" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={busy || note.trim() === ''}
              onClick={() =>
                void run(
                  () => api(`${base}/reject`, { method: 'POST', json: { note: note.trim() } }),
                  t('content.rejected'),
                  async () => {
                    setRejecting(false);
                    setNote('');
                    await onChanged();
                  },
                )
              }
            >
              {t('content.reject')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('content.deleteTitle')}
        description={def.private ? t('content.deletePrivateDescription') : t('content.deleteDescription')}
        confirmLabel={t('content.delete')}
        destructive
        onConfirm={() => void run(() => api(base, { method: 'DELETE' }), t('content.deleted'), onDeleted)}
      />
    </>
  );
}
