// Which editor buttons an entry shows (spec B 6.4, controller ruling R11). Pure; relative imports only.

/** Mirrors the server workflow state; declared locally (ruling R4). */
export type WorkflowState = 'draft' | 'in_review';

export type EntryAction = 'save' | 'publish' | 'submit' | 'withdraw' | 'approve' | 'reject' | 'unpublish';

export interface EntryActionsInput {
  review: boolean;
  workflow: { state: WorkflowState; submittedBy?: { id: string } | null } | null;
  published: boolean;
  permissions: readonly string[];
  userId: string;
}

const inReview = (i: EntryActionsInput) => i.review && i.workflow?.state === 'in_review';

/** In review, only holders of `content.publish` may edit (the server answers 409 in_review_locked otherwise). */
export function formLocked(i: EntryActionsInput): boolean {
  return inReview(i) && !i.permissions.includes('content.publish');
}

export function entryActions(i: EntryActionsInput): EntryAction[] {
  const has = (p: string) => i.permissions.includes(p);
  const out: EntryAction[] = [];
  const mayPublish = i.review ? has('content.publish') : has('content.update') || has('content.publish');

  if (inReview(i)) {
    const submitter = i.permissions.length > 0 && !!i.userId && i.workflow?.submittedBy?.id === i.userId;
    if (has('content.publish')) out.push('save', 'approve', 'reject');
    if (submitter) out.push('withdraw');
  } else {
    if (i.review) {
      if (has('content.submit') || has('content.publish')) out.push('save');
      if (has('content.publish')) out.push('publish');
      if (has('content.submit')) out.push('submit');
    } else if (mayPublish) {
      out.push('save', 'publish');
    }
  }
  if (i.published && mayPublish) out.push('unpublish');
  return out;
}
