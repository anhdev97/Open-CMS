import { describe, expect, it } from 'vitest';
import { nextState, type WorkflowAction, type WorkflowState } from '../../src/workflow';

describe('workflow nextState (spec B §5.2)', () => {
  const table: [WorkflowState, WorkflowAction, WorkflowState | 'cleared' | null][] = [
    ['draft', 'submit', 'in_review'],
    ['draft', 'withdraw', null],
    ['draft', 'reject', null],
    ['draft', 'publish', 'cleared'],
    ['draft', 'approve', null],
    ['in_review', 'submit', null],
    ['in_review', 'withdraw', 'draft'],
    ['in_review', 'reject', 'draft'],
    ['in_review', 'publish', 'cleared'],
    ['in_review', 'approve', 'cleared'],
  ];

  it.each(table)('%s + %s -> %s', (state, action, expected) => {
    expect(nextState(state, action)).toBe(expected);
  });

  it('covers every state x action pair', () => {
    expect(new Set(table.map(([s, a]) => `${s}:${a}`)).size).toBe(10);
  });
});
