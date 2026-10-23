/**
 * Fixed role catalog (spec B §3.1). Groups store a subset of these; a `system` group (Super Admin) always
 * counts as having all of them, including ones added later. Pure: shared by the server and the admin.
 */
export const PERMISSIONS = [
  'content.read',
  'content.create',
  'content.update',
  'content.delete',
  'content.submit',
  'content.publish',
  'settings.users',
  'settings.groups',
  'settings.content-types',
  'settings.languages',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const KNOWN: ReadonlySet<string> = new Set(PERMISSIONS);

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && KNOWN.has(value);
}
