import { describe, expect, it } from 'vitest';
import { groupUpdateInput } from '../../admin/src/lib/groups';

describe('groupUpdateInput', () => {
  it('never sends name for seed groups', () => {
    expect(groupUpdateInput({ key: 'contenter', name: 'Contenter' }, 'Biên tập nội dung', ['content.read'])).toEqual({ roles: ['content.read'] });
  });
  it('omits an unchanged custom name', () => {
    expect(groupUpdateInput({ key: 'qa', name: 'QA' }, ' QA ', [])).toEqual({ roles: [] });
  });
  it('sends a changed custom name trimmed', () => {
    expect(groupUpdateInput({ key: 'qa', name: 'QA' }, ' Quality ', [])).toEqual({ name: 'Quality', roles: [] });
  });
});
