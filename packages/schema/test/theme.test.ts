import { describe, expect, it } from 'vitest';
import { activeColors, defineTheme, validateTheme, type ThemeDefinition } from '../src/theme';

const theme = () => defineTheme({
  colors: { accent: { label: 'Accent' }, line: {} },
  palettes: {
    default: { values: { accent: '#ff0000', line: '#eeeeee' } },
    clay: { label: 'Clay', values: { accent: '#aa5533', line: '#ddccbb' } },
  },
  activePalette: 'clay',
});

describe('theme', () => {
  it('accepts a valid theme', () => expect(validateTheme(theme())).toEqual([]));
  it('flags a palette missing a color', () => {
    const t = theme();
    delete t.palettes.clay.values.line;
    expect(validateTheme(t).map((i) => i.path)).toContainEqual(['palettes', 'clay', 'values', 'line']);
  });
  it('flags unknown activePalette', () => {
    expect(validateTheme({ ...theme(), activePalette: 'nope' }).map((i) => i.path)).toContainEqual(['activePalette']);
  });
  it('flags invalid hex', () => {
    const t = theme();
    t.palettes.clay.values.accent = 'red';
    expect(validateTheme(t).map((i) => i.path)).toContainEqual(['palettes', 'clay', 'values', 'accent']);
  });
  it('flags invalid color names', () => {
    expect(validateTheme({ ...theme(), colors: { Bad: {} } }).map((i) => i.path)).toContainEqual(['colors', 'Bad']);
  });
  it('activeColors returns the active palette values', () => {
    expect(activeColors(theme())).toEqual({ accent: '#aa5533', line: '#ddccbb' });
  });
});

describe('theme inherited keys', () => {
  it('does not treat inherited keys as present', () => {
    expect(validateTheme({ ...theme(), activePalette: 'constructor' }).map((i) => i.path)).toContainEqual(['activePalette']);
    const t = defineTheme({
      colors: { constructor: {} } as ThemeDefinition['colors'],
      palettes: { clay: { values: {} } },
      activePalette: 'clay',
    });
    expect(validateTheme(t).map((i) => i.path)).toContainEqual(['palettes', 'clay', 'values', 'constructor']);
  });
});
