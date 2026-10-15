export const en = {
  app: {
    name: 'OpenCMS',
    loading: 'Loading the admin…',
    comingSoon: 'The admin screens are on their way.',
  },
} as const;

/** Looks up a dot path in `en` and fills `{name}` placeholders; returns the key itself when it is missing. */
export function t(key: string, vars?: Record<string, string | number>): string {
  let node: unknown = en;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object' || !(part in node)) return key;
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node !== 'string') return key;
  if (!vars) return node;
  return node.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}
