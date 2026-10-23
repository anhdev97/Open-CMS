import { describe, expect, it } from 'vitest';
import { PERMISSIONS as SCHEMA_PERMISSIONS } from '@opencms/schema';
import { PERMISSIONS, effectivePermissions } from '../../src/permissions';

const CONTENTER = ['content.read', 'content.create', 'content.update', 'content.delete', 'content.submit'];
const REVIEWER = ['content.read', 'content.update', 'content.publish'];

describe('PERMISSIONS', () => {
  it('is the fixed catalog, re-exported from @opencms/schema', () => {
    expect(PERMISSIONS).toEqual([
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
    ]);
    expect(PERMISSIONS).toBe(SCHEMA_PERMISSIONS);
  });
});

describe('effectivePermissions', () => {
  it('a system group grants every permission', () => {
    expect(effectivePermissions([{ system: true, roles: [] }])).toEqual([...PERMISSIONS].sort());
    expect(effectivePermissions([{ system: false, roles: ['content.read'] }, { system: true, roles: [] }])).toEqual(
      [...PERMISSIONS].sort(),
    );
  });

  it('non-system groups: sorted union without duplicates', () => {
    expect(effectivePermissions([
      { system: false, roles: CONTENTER },
      { system: false, roles: REVIEWER },
    ])).toEqual([
      'content.create',
      'content.delete',
      'content.publish',
      'content.read',
      'content.submit',
      'content.update',
    ]);
  });

  it('drops unknown roles', () => {
    expect(effectivePermissions([{ system: false, roles: ['content.read', 'bogus', 'super_admin'] }])).toEqual(['content.read']);
  });

  it('no groups → []', () => {
    expect(effectivePermissions([])).toEqual([]);
    expect(effectivePermissions([{ system: false, roles: [] }])).toEqual([]);
  });
});
