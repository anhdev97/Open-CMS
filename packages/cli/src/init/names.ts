import * as path from 'node:path';

const base = (dir: string) => path.basename(path.resolve(dir));

export function packageNameFor(dir: string): string {
  const name = base(dir)
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-._]+|-+$/g, '')
    .slice(0, 214);
  return name || 'opencloudcms-project';
}

export function dbNameFor(dir: string): string {
  let name = base(dir)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!name) return 'opencloudcms';
  if (/^[0-9]/.test(name)) name = `db_${name}`;
  // Postgres identifiers are limited to 63 bytes.
  return name.slice(0, 63).replace(/_+$/, '');
}
