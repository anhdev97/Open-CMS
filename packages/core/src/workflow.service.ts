/**
 * Review workflow (spec B §5): state per document in `opencms_workflow`, only for types with `review: true`.
 * Every transition runs in a transaction that creates the row if missing and locks it (`FOR UPDATE`) before
 * checking the state, so of two concurrent transitions one succeeds and the other gets 409 `invalid_transition`.
 * For a type whose `review` was turned off, rows are ignored when read and removed on the document's next write.
 */
import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { mainTable, SYSTEM_TABLES, type ContentTypeDefinition } from '@opencms/schema';
import { AuditService, AuthError, type AuditType, type RequestUser } from '@opencms/oauth2';
import { OPENCMS_DB } from './options';
import { ContentRegistry } from './registry.service';
import { nextState, type WorkflowAction, type WorkflowInfo, type WorkflowState } from './workflow';

type Row = Record<string, unknown>;
type Actor = Pick<RequestUser, 'id' | 'permissions'>;

interface WorkflowRow {
  state: WorkflowState;
  submitted_by: string | null;
}

const T = SYSTEM_TABLES.workflow;
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null) ?? null);
const has = (user: Pick<RequestUser, 'permissions'>, p: string) => user.permissions.includes(p as never);

const invalid = (action: WorkflowAction, state: WorkflowState) =>
  new ConflictException({ code: 'invalid_transition', message: `Cannot ${action} an entry in state "${state}"` });

const AUDIT: Record<WorkflowAction, AuditType> = {
  submit: 'content.submit',
  withdraw: 'content.withdraw',
  reject: 'content.reject',
  publish: 'content.publish',
  approve: 'content.approve',
};

@Injectable()
export class WorkflowService {
  constructor(
    @Inject(OPENCMS_DB) private readonly db: Kysely<any>,
    @Inject(ContentRegistry) private readonly registry: ContentRegistry,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Adds `workflow` to draft entries (null when there is no row, or the type has no review). */
  async attach(def: ContentTypeDefinition, entries: Row[]): Promise<void> {
    const drafts = entries.filter((e) => e.status === 'draft');
    if (!drafts.length) return;
    const byDoc = new Map<string, WorkflowInfo>();
    if (def.review) {
      const rows = await this.db
        .selectFrom(`${T} as w`)
        .leftJoin('auth_users as u', 'u.id', 'w.submitted_by')
        .select(['w.document_id', 'w.state', 'w.submitted_by', 'w.submitted_at', 'w.note', 'u.name as submitter_name'])
        .where('w.api_id', '=', def.apiId)
        .where('w.document_id', 'in', drafts.map((e) => e.documentId as string))
        .execute();
      for (const r of rows) {
        byDoc.set(r.document_id, {
          state: r.state,
          submittedBy: r.submitted_by && r.submitter_name != null ? { id: r.submitted_by, name: r.submitter_name } : null,
          submittedAt: iso(r.submitted_at),
          note: r.note ?? null,
        });
      }
    }
    for (const e of drafts) e.workflow = byDoc.get(e.documentId as string) ?? null;
  }

  /**
   * Creates the row if missing (rolled back unless the transition writes it) and locks it. The insert is a
   * no-op while the row exists; if a concurrent transaction deletes it (publish) before our lock is granted,
   * the locking select comes back empty under READ COMMITTED, so try again: the next insert creates a draft row.
   */
  private async lock(trx: Kysely<any>, def: ContentTypeDefinition, documentId: string): Promise<WorkflowRow> {
    for (let attempt = 0; attempt < 5; attempt++) {
      await trx
        .insertInto(T)
        .values({ api_id: def.apiId, document_id: documentId, state: 'draft' })
        .onConflict((oc) => oc.columns(['api_id', 'document_id']).doNothing())
        .execute();
      const row = await trx
        .selectFrom(T)
        .select(['state', 'submitted_by'])
        .where('api_id', '=', def.apiId)
        .where('document_id', '=', documentId)
        .forUpdate()
        .executeTakeFirst();
      if (row) return row as WorkflowRow;
    }
    throw new ConflictException({ code: 'invalid_transition', message: 'Workflow state changed concurrently, try again' });
  }

  private async clear(trx: Kysely<any>, def: ContentTypeDefinition, documentId: string): Promise<void> {
    await trx.deleteFrom(T).where('api_id', '=', def.apiId).where('document_id', '=', documentId).execute();
  }

  private async record(trx: Kysely<any>, action: WorkflowAction, def: ContentTypeDefinition, documentId: string, user: Actor, meta: Row = {}) {
    await this.audit.record({ type: AUDIT[action], actorId: user.id, meta: { apiId: def.apiId, documentId, ...meta } }, trx as never);
  }

  /** submit / withdraw / reject. */
  async transition(def: ContentTypeDefinition, documentId: string, action: Exclude<WorkflowAction, 'publish' | 'approve'>, user: Actor, note?: unknown) {
    if (action === 'withdraw' && !has(user, 'content.submit') && !has(user, 'content.publish')) {
      throw new AuthError('forbidden', 403, 'Missing permission: content.publish');
    }
    let text: string | undefined;
    if (action === 'reject') {
      text = typeof note === 'string' ? note.trim() : '';
      if (text.length < 1 || text.length > 1000) {
        throw new UnprocessableEntityException({
          code: 'validation_failed',
          message: 'note must be 1-1000 characters',
          issues: [{ path: 'note', message: 'note must be 1-1000 characters' }],
        });
      }
    }
    await this.db.transaction().execute(async (trx) => {
      const draft = await trx
        .selectFrom(mainTable(def))
        .select('id')
        .where('document_id', '=', documentId)
        .where('status', '=', 'draft')
        .executeTakeFirst();
      if (!draft) throw new NotFoundException(`${def.apiId} ${documentId} not found`);
      // review turned off: any row is ignored, so the state is draft and no transition applies.
      if (!def.review) throw invalid(action, 'draft');
      const row = await this.lock(trx, def, documentId);
      const next = nextState(row.state, action);
      if (next === null || next === 'cleared') throw invalid(action, row.state);
      const where = (q: any) => q.where('api_id', '=', def.apiId).where('document_id', '=', documentId);
      if (action === 'submit') {
        await where(
          trx.updateTable(T).set({ state: next, submitted_by: user.id, submitted_at: sql`now()`, reviewed_by: null, reviewed_at: null, note: null }),
        ).execute();
      } else if (action === 'withdraw') {
        if (row.submitted_by !== user.id && !has(user, 'content.publish')) {
          throw new AuthError('forbidden', 403, 'Missing permission: content.publish');
        }
        await where(trx.updateTable(T).set({ state: next, note: null })).execute();
      } else {
        await where(trx.updateTable(T).set({ state: next, reviewed_by: user.id, reviewed_at: sql`now()`, note: text })).execute();
      }
      await this.record(trx, action, def, documentId, user, action === 'reject' ? { note: text } : {});
    });
  }

  /** Inside the PATCH transaction: In review is locked without `content.publish` (B7). */
  async guardUpdate(trx: Kysely<any>, def: ContentTypeDefinition, documentId: string, user?: Pick<RequestUser, 'permissions'>) {
    if (!def.review) return this.clear(trx, def, documentId);
    if (!user) return;
    const row = await trx
      .selectFrom(T)
      .select('state')
      .where('api_id', '=', def.apiId)
      .where('document_id', '=', documentId)
      .forUpdate()
      .executeTakeFirst();
    if (row?.state === 'in_review' && !has(user, 'content.publish')) {
      throw new ConflictException({ code: 'in_review_locked', message: 'Entry is in review' });
    }
  }

  /** Fast, unlocked check before validation and hooks; `guardPublish` decides. */
  async precheckPublish(def: ContentTypeDefinition, documentId: string, action: 'publish' | 'approve' = 'publish') {
    if (!def.review) {
      if (action === 'approve') throw invalid(action, 'draft');
      return;
    }
    const row = await this.db
      .selectFrom(T)
      .select('state')
      .where('api_id', '=', def.apiId)
      .where('document_id', '=', documentId)
      .executeTakeFirst();
    const state: WorkflowState = row?.state ?? 'draft';
    if (nextState(state, action) === null) throw invalid(action, state);
  }

  /**
   * Inside the publish transaction. `publish` clears the row from any state (locked, so it serializes with
   * transitions); `approve` needs In review, so of two concurrent approvals the second sees the row gone (409).
   */
  async guardPublish(trx: Kysely<any>, def: ContentTypeDefinition, documentId: string, user: Actor, action: 'publish' | 'approve' = 'publish') {
    if (!def.review) {
      if (action === 'approve') throw invalid(action, 'draft');
    } else {
      const row = await this.lock(trx, def, documentId);
      if (nextState(row.state, action) === null) throw invalid(action, row.state);
    }
    await this.clear(trx, def, documentId);
    await this.record(trx, action, def, documentId, user, { review: !!def.review });
  }

  async guardDelete(trx: Kysely<any>, def: ContentTypeDefinition, documentId: string) {
    await this.clear(trx, def, documentId);
  }

  /** Spec B §5.3: entries waiting for review, for types that currently have `review: true`. */
  async pendingCount(): Promise<{ count: number; byType: Record<string, number> }> {
    const byType: Record<string, number> = {};
    let count = 0;
    for (const def of this.registry.all().filter((d) => d.review)) {
      // Only rows whose draft still exists (orphans are not counted).
      const r = await this.db
        .selectFrom(`${T} as w`)
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('w.api_id', '=', def.apiId)
        .where('w.state', '=', 'in_review')
        .where(({ exists, selectFrom }) =>
          exists(
            selectFrom(`${mainTable(def)} as m`)
              .select(sql.lit(1).as('one'))
              .whereRef('m.document_id', '=', 'w.document_id')
              .where('m.status', '=', 'draft'),
          ),
        )
        .executeTakeFirst();
      const n = Number(r?.n ?? 0);
      if (n > 0) {
        byType[def.apiId] = n;
        count += n;
      }
    }
    return { count, byType };
  }
}
