import { STYLE_COLOR_TOKENS, STYLE_SPACING_TOKENS } from '@opencloudcms/schema';
import { describe, expect, it } from 'vitest';
import { COLOR_TOKENS, SPACING_TOKENS } from '../../blocks/src/types';

describe('schema style tokens', () => {
  it('match the blocks token lists', () => {
    expect([...STYLE_SPACING_TOKENS]).toEqual([...SPACING_TOKENS]);
    expect([...STYLE_COLOR_TOKENS]).toEqual([...COLOR_TOKENS]);
  });
});
