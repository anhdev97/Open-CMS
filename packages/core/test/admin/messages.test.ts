import { describe, expect, it } from 'vitest';
import { enUS } from '../../admin/src/i18n/messages/en-US';

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
const base = flatten(enUS as unknown as Tree);

const bundles = {
  'vi-VN': () => import('../../admin/src/i18n/messages/vi-VN'),
  'fr-FR': () => import('../../admin/src/i18n/messages/fr-FR'),
  'id-ID': () => import('../../admin/src/i18n/messages/id-ID'),
};

describe.each(Object.entries(bundles))('%s bundle', (_code, load) => {
  it('has the same keys, placeholders, non-empty values and is translated', async () => {
    const flat = flatten((await load()).default as unknown as Tree);
    expect(Object.keys(flat).sort()).toEqual(Object.keys(base).sort());
    let same = 0;
    for (const [key, en] of Object.entries(base)) {
      const v = flat[key]!;
      expect(v.trim(), key).not.toBe('');
      expect(placeholders(v), key).toEqual(placeholders(en));
      if (v === en) same++;
    }
    expect(same / Object.keys(base).length).toBeLessThanOrEqual(0.25);
  });
});
