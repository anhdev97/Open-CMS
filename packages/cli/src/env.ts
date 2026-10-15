import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseEnv } from 'node:util';

/** Load `<root>/.env` into `env`; variables that are already defined win. */
export function loadProjectEnv(root: string, env: NodeJS.ProcessEnv = process.env): void {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return;
  const parsed = parseEnv(fs.readFileSync(file, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] === undefined) env[key] = value;
  }
}
