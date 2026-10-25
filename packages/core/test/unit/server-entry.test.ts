import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as core from '../../src';
import * as rsc from '../../src/i18n';

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
const I18N = ['SUPPORTED_LOCALES', 'isLocale', 'matchLocale', 'localizedText', 'defineMessages', 'createTranslator', 'formatDateTime', 'formatNumber'];

describe('@opencloudcms/core react-server entry', () => {
  it('server components resolve "." to the Nest-free i18n module', () => {
    const dot = pkg.exports['.'];
    expect(Object.keys(dot)).toEqual(['types', 'react-server', 'default']);
    expect(dot['react-server']).toBe('./dist/i18n.js');
    expect(dot.default).toBe('./dist/index.js');
  });

  it('exports exactly the public i18n API, the same functions as the main entry', () => {
    expect(Object.keys(rsc).sort()).toEqual([...I18N].sort());
    for (const k of I18N) expect((rsc as Record<string, unknown>)[k]).toBe((core as Record<string, unknown>)[k]);
  });

  it('imports nothing but @opencloudcms/schema', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/i18n.ts'), 'utf8');
    const specifiers = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(new Set(specifiers)).toEqual(new Set(['@opencloudcms/schema']));
  });
});
