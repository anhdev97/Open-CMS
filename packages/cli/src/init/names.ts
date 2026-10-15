import * as path from 'node:path';

const base = (dir: string) => path.basename(path.resolve(dir));

export function packageNameFor(dir: string): string {
  const name = base(dir)
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return name || 'opencms-project';
}

export function dbNameFor(dir: string): string {
  let name = base(dir)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!name) return 'opencms';
  if (/^[0-9]/.test(name)) name = `db_${name}`;
  return name;
}
