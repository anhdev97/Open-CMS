import * as fs from 'node:fs';
import * as path from 'node:path';

const PAGE_FILE = /^page\.(tsx|ts|jsx|js|mdx)$/;

/**
 * Static URL paths of the file routes of the website (`<dir>/app/(site)/**\/page.*`), which Next serves before the
 * page-builder catch-all: a page built in the admin at one of these paths is never shown. Route groups `(x)` and
 * parallel-route slots `@x` add no URL segment; dynamic segments (`[x]`, so also the catch-all itself), private
 * folders (`_x`) and intercepting routes (`(.)x`) are skipped. Sorted, without duplicates.
 */
export function shadowedPagePaths(dir: string): string[] {
  const site = path.join(dir, 'app', '(site)');
  const out = new Set<string>();
  const walk = (abs: string, segments: string[]) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isFile() && PAGE_FILE.test(e.name)) out.add('/' + segments.join('/'));
      if (!e.isDirectory() || e.name === 'node_modules') continue;
      const name = e.name;
      if (name.includes('[') || name.startsWith('_') || name.startsWith('(.')) continue;
      const group = /^\(.+\)$/.test(name) || name.startsWith('@');
      walk(path.join(abs, name), group ? segments : [...segments, decodeSegment(name)]);
    }
  };
  walk(site, []);
  return [...out].sort();
}

/** `%5F` is Next's escape for a segment starting with `_`. */
function decodeSegment(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}
