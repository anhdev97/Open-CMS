import { describe, expect, it } from 'vitest';
import { CONFIG_FILE_NAMES } from '../src/config';

describe('CONFIG_FILE_NAMES', () => {
  it('discovers opencloudcms.config.* only', () => {
    expect(CONFIG_FILE_NAMES).toEqual(['opencloudcms.config.ts', 'opencloudcms.config.js']);
  });
});
