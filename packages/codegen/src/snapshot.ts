import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ContentTypeDefinition } from '@opencloudcms/schema';

export const SNAPSHOT_FILE = '_snapshot.json';

export interface Snapshot {
  version: 1;
  /** Name of the migration that produced this snapshot (null for meta-only updates). */
  lastMigration: string | null;
  contentTypes: ContentTypeDefinition[];
}

export function emptySnapshot(): Snapshot {
  return { version: 1, lastMigration: null, contentTypes: [] };
}

export function readSnapshot(migrationsDir: string): Snapshot {
  const file = path.join(migrationsDir, SNAPSHOT_FILE);
  if (!fs.existsSync(file)) return emptySnapshot();
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Snapshot;
  if (parsed.version !== 1) throw new Error(`Unsupported snapshot version ${parsed.version} in ${file}`);
  return parsed;
}

export function writeSnapshot(migrationsDir: string, snapshot: Snapshot): void {
  fs.mkdirSync(migrationsDir, { recursive: true });
  const sorted = { ...snapshot, contentTypes: [...snapshot.contentTypes].sort((a, b) => a.apiId.localeCompare(b.apiId)) };
  fs.writeFileSync(path.join(migrationsDir, SNAPSHOT_FILE), JSON.stringify(sorted, null, 2) + '\n');
}
