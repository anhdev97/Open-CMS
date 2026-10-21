import * as fs from 'node:fs';
import * as path from 'node:path';

/** Project root = nearest directory (walking up from `from`) with a package.json; works from src/ and dist/src/. */
export function findProjectRoot(from: string): string {
  let dir = from;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}
