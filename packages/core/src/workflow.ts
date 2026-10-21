/**
 * Review workflow transition table (spec B §5.2), pure. Applies to content types with `review: true`;
 * a missing workflow row is `draft`. `cleared` means the row is deleted (published), `null` an invalid
 * transition (409 `invalid_transition`). `publish` is a direct publish by a `content.publish` holder and is
 * allowed from any state (ruling R11); `approve` publishes what was submitted, so only from In review.
 */
export type WorkflowState = 'draft' | 'in_review';
export type WorkflowAction = 'submit' | 'withdraw' | 'reject' | 'publish' | 'approve';

const TABLE: Record<WorkflowState, Record<WorkflowAction, WorkflowState | 'cleared' | null>> = {
  draft: { submit: 'in_review', withdraw: null, reject: null, publish: 'cleared', approve: null },
  in_review: { submit: null, withdraw: 'draft', reject: 'draft', publish: 'cleared', approve: 'cleared' },
};

export function nextState(current: WorkflowState, action: WorkflowAction): WorkflowState | 'cleared' | null {
  return TABLE[current]?.[action] ?? null;
}

/** `workflow` field of a draft entry (spec B §5.3). */
export interface WorkflowInfo {
  state: WorkflowState;
  submittedBy: { id: string; name: string } | null;
  submittedAt: string | null;
  note: string | null;
}
