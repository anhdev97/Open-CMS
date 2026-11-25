// Button actions and the name patterns they target. Must not import from `node:*`.
import type { ComposedIssue } from './composed-block';

/** Region, overlay and overlay-action target names. */
export const OVERLAY_NAME_RE = /^[a-z][a-z0-9-]{0,31}$/;
/** `anchorId` prop values and scroll-action targets (an element id on the page). */
export const ANCHOR_ID_RE = /^[A-Za-z][\w-]{0,63}$/;

export type ButtonAction =
  | { type: 'overlay'; op: 'open' | 'close' | 'toggle'; target?: string }
  | { type: 'scroll'; target: string };

const OPS = ['open', 'close', 'toggle'];

export function validateButtonAction(v: unknown, path: (string | number)[]): ComposedIssue[] {
  const issues: ComposedIssue[] = [];
  const add = (p: (string | number)[], message: string) => issues.push({ path: p, message });
  if (!v || typeof v !== 'object' || Array.isArray(v)) return [{ path, message: 'action must be an object' }];
  const a = v as Record<string, unknown>;
  if (a.type === 'overlay') {
    if (typeof a.op !== 'string' || !OPS.includes(a.op)) add([...path, 'op'], `op must be one of ${OPS.join(', ')}`);
    if (a.target === undefined) {
      if (a.op === 'open' || a.op === 'toggle') add([...path, 'target'], `${a.op} requires a target overlay name`);
    } else if (typeof a.target !== 'string' || !OVERLAY_NAME_RE.test(a.target)) {
      add([...path, 'target'], 'target must match ^[a-z][a-z0-9-]{0,31}$');
    }
  } else if (a.type === 'scroll') {
    if (typeof a.target !== 'string' || !ANCHOR_ID_RE.test(a.target)) add([...path, 'target'], 'target must match ^[A-Za-z][\\w-]{0,63}$');
  } else {
    add([...path, 'type'], "type must be 'overlay' or 'scroll'");
  }
  return issues;
}
