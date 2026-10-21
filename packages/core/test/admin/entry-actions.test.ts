import { describe, expect, it } from 'vitest';
import { entryActions, formLocked } from '../../admin/src/lib/entry-actions';

const draft = { state: 'draft' as const, submittedBy: null };
const inReview = (id = 'u2') => ({ state: 'in_review' as const, submittedBy: { id } });
const base = { review: false, workflow: null, published: false, userId: 'u1' };

describe('entryActions (spec B 6.4)', () => {
  it('review:false, draft, content.update -> save, publish', () => {
    expect(entryActions({ ...base, permissions: ['content.update'] })).toEqual(['save', 'publish']);
  });
  it('review:false, draft, content.publish only -> save, publish', () => {
    expect(entryActions({ ...base, permissions: ['content.publish'] })).toEqual(['save', 'publish']);
  });
  it('review:true, draft, content.submit -> save, submit', () => {
    expect(entryActions({ ...base, review: true, workflow: draft, permissions: ['content.submit'] })).toEqual(['save', 'submit']);
  });
  it('review:true, draft, content.publish -> save, publish (direct)', () => {
    expect(entryActions({ ...base, review: true, permissions: ['content.publish'] })).toEqual(['save', 'publish']);
  });
  it('review:true, draft, content.publish + content.submit -> save, publish, submit', () => {
    expect(entryActions({ ...base, review: true, permissions: ['content.publish', 'content.submit'] })).toEqual(['save', 'publish', 'submit']);
  });
  it('review:true, in review, submitter without publish -> withdraw, form locked', () => {
    const input = { ...base, review: true, workflow: inReview('u1'), permissions: ['content.submit', 'content.update'] };
    expect(entryActions(input)).toEqual(['withdraw']);
    expect(formLocked(input)).toBe(true);
  });
  it('review:true, in review, other user without publish -> nothing, locked', () => {
    const input = { ...base, review: true, workflow: inReview('u2'), permissions: ['content.submit'] };
    expect(entryActions(input)).toEqual([]);
    expect(formLocked(input)).toBe(true);
  });
  it('review:true, in review, content.publish -> save, approve, reject, unlocked', () => {
    const input = { ...base, review: true, workflow: inReview('u2'), permissions: ['content.publish'] };
    expect(entryActions(input)).toEqual(['save', 'approve', 'reject']);
    expect(formLocked(input)).toBe(false);
  });
  it('in-review submitter who also has publish -> approve/reject plus withdraw, unlocked', () => {
    const input = { ...base, review: true, workflow: inReview('u1'), permissions: ['content.publish', 'content.submit'] };
    expect(entryActions(input)).toEqual(['save', 'approve', 'reject', 'withdraw']);
    expect(formLocked(input)).toBe(false);
  });
  it('published, may publish -> unpublish added', () => {
    expect(entryActions({ ...base, published: true, permissions: ['content.update'] })).toEqual(['save', 'publish', 'unpublish']);
    expect(entryActions({ ...base, review: true, published: true, permissions: ['content.publish'] })).toEqual(['save', 'publish', 'unpublish']);
  });
  it('published review type, submit only -> no unpublish', () => {
    expect(entryActions({ ...base, review: true, published: true, permissions: ['content.submit'] })).toEqual(['save', 'submit']);
  });
  it('0 permissions -> []', () => {
    expect(entryActions({ ...base, permissions: [] })).toEqual([]);
    expect(entryActions({ ...base, review: true, workflow: inReview('u1'), permissions: [] })).toEqual([]);
    expect(formLocked({ ...base, permissions: [] })).toBe(false);
  });
  it('review:false ignores a stale in_review workflow row', () => {
    expect(entryActions({ ...base, workflow: inReview('u2'), permissions: ['content.update'] })).toEqual(['save', 'publish']);
  });
});
