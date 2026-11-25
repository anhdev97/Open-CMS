import { describe, expect, it } from 'vitest';
import { ANCHOR_ID_RE, OVERLAY_NAME_RE, validateButtonAction } from '../src/actions';

const paths = (v: unknown) => validateButtonAction(v, ['a']).map((i) => i.path.join('.'));

describe('validateButtonAction', () => {
  it('accepts valid actions', () => {
    expect(paths({ type: 'overlay', op: 'open', target: 'menu-mobile' })).toEqual([]);
    expect(paths({ type: 'overlay', op: 'toggle', target: 'menu' })).toEqual([]);
    expect(paths({ type: 'overlay', op: 'close' })).toEqual([]);
    expect(paths({ type: 'overlay', op: 'close', target: 'menu' })).toEqual([]);
    expect(paths({ type: 'scroll', target: 'gioi-thieu' })).toEqual([]);
  });
  it('requires a target for open and toggle', () => {
    expect(paths({ type: 'overlay', op: 'open' })).toEqual(['a.target']);
    expect(paths({ type: 'overlay', op: 'toggle' })).toEqual(['a.target']);
  });
  it('rejects bad values', () => {
    expect(paths({ type: 'overlay', op: 'zoom', target: 'x' })).toEqual(['a.op']);
    expect(paths({ type: 'overlay', op: 'open', target: 'Bad Name' })).toEqual(['a.target']);
    expect(paths({ type: 'scroll', target: '1bad' })).toEqual(['a.target']);
    expect(paths({ type: 'scroll' })).toEqual(['a.target']);
    expect(paths({ type: 'nope' })).toEqual(['a.type']);
    expect(paths('x')).toEqual(['a']);
  });
  it('exports the name patterns', () => {
    expect(OVERLAY_NAME_RE.test('a'.repeat(32))).toBe(true);
    expect(OVERLAY_NAME_RE.test('a'.repeat(33))).toBe(false);
    expect(ANCHOR_ID_RE.test('a_b-1')).toBe(true);
    expect(ANCHOR_ID_RE.test('a b')).toBe(false);
  });
});
