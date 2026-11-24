import { describe, expect, it } from 'vitest';
import { isColorValue, isLength, isTrack, resolveResponsive, setAt, valueAt, validateNodeStyle } from '../src/style';

describe('isLength', () => {
  it('accepts tokens and custom lengths', () => {
    expect(isLength('37px')).toBe(true);
    expect(isLength('8')).toBe(true);
    expect(isLength('5%')).toBe(true);
  });
  it('rejects negatives unless allowed', () => {
    expect(isLength('-4px')).toBe(false);
    expect(isLength('-4px', { negative: true })).toBe(true);
  });
  it('rejects unsafe or out of range values', () => {
    expect(isLength('1e9px')).toBe(false);
    expect(isLength('10001px')).toBe(false);
    expect(isLength('4px;color:red')).toBe(false);
    expect(isLength(4)).toBe(false);
  });
  it('accepts auto only when allowed', () => {
    expect(isLength('auto')).toBe(false);
    expect(isLength('auto', { auto: true })).toBe(true);
  });
});

describe('isColorValue', () => {
  it('accepts tokens, brand colors and hex', () => {
    for (const v of ['brand:accent-ink', '#fbf8ef', '#fff', '#fbf8efaa', 'primary']) expect(isColorValue(v)).toBe(true);
  });
  it('rejects the rest', () => {
    for (const v of ['brand:Foo', '#12', 'red', 'red;x', 3]) expect(isColorValue(v)).toBe(false);
  });
});

describe('isTrack', () => {
  it('accepts fr, auto and lengths', () => {
    for (const v of ['2fr', 'auto', '240px']) expect(isTrack(v)).toBe(true);
  });
  it('rejects out of range fr', () => {
    expect(isTrack('13fr')).toBe(false);
    expect(isTrack('0fr')).toBe(false);
  });
});

describe('responsive helpers', () => {
  it('resolveResponsive', () => {
    expect(resolveResponsive('4')).toEqual({ base: '4' });
    expect(resolveResponsive({ md: '4' })).toEqual({ md: '4' });
    expect(resolveResponsive(undefined)).toEqual({});
  });
  it('valueAt inherits from smaller breakpoints', () => {
    expect(valueAt({ base: '4', lg: '8' }, 'md')).toEqual({ value: '4', from: 'base' });
    expect(valueAt({ base: '4', lg: '8' }, 'lg')).toEqual({ value: '8', from: 'lg' });
    expect(valueAt({ lg: '8' }, 'md')).toEqual({ value: undefined, from: null });
  });
  it('setAt', () => {
    expect(setAt('4', 'md', '8')).toEqual({ base: '4', md: '8' });
    expect(setAt('4', 'base', '6')).toBe('6');
    expect(setAt({ md: '8' }, 'md', undefined)).toBeUndefined();
    expect(setAt(undefined, 'lg', '2')).toEqual({ lg: '2' });
  });
});

describe('validateNodeStyle', () => {
  it('flags negative padding but not negative margin', () => {
    expect(validateNodeStyle({ padding: { t: '-4px' } }, ['s']).map((i) => i.path)).toContainEqual(['s', 'padding', 't']);
    expect(validateNodeStyle({ margin: { t: '-4px', l: 'auto' } }, ['s'])).toEqual([]);
  });
  it('flags auto padding', () => {
    expect(validateNodeStyle({ padding: 'auto' }, ['s'])).not.toEqual([]);
  });
  it('validates responsive values per breakpoint', () => {
    expect(validateNodeStyle({ width: { base: '100%', md: 'x' } }, ['s']).map((i) => i.path)).toContainEqual(['s', 'width', 'md']);
    expect(validateNodeStyle({ width: { base: '100%', md: '50%' }, hidden: { md: true } }, ['s'])).toEqual([]);
  });
  it('validates colors, borders, radius, span', () => {
    expect(validateNodeStyle({ background: 'brand:accent', color: '#fff', borderColor: 'primary', borderWidth: '2', radius: '8px', borderSides: ['b'], span: { base: 'full', md: 6 } }, ['s'])).toEqual([]);
    const bad = validateNodeStyle({ color: 'red;x', borderWidth: '3', radius: '-1px', borderSides: ['x'], span: 13, hidden: { xl: true } }, ['s']);
    const paths = bad.map((i) => i.path.join('.'));
    for (const p of ['s.color', 's.borderWidth', 's.radius', 's.borderSides.0', 's.span', 's.hidden.xl']) expect(paths).toContain(p);
  });
  it('rejects unknown keys and non-objects', () => {
    expect(validateNodeStyle({ foo: 1 }, ['s'])).not.toEqual([]);
    expect(validateNodeStyle('x', ['s'])).not.toEqual([]);
    expect(validateNodeStyle(undefined, ['s'])).toEqual([]);
  });
});
