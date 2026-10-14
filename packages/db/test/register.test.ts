import { describe, expect, it } from 'vitest';
import type { Migration } from 'kysely';
import { allCoreMigrations, registerCoreMigrations } from '../src/index';

const noop: Migration = { async up() {}, async down() {} };

describe('registerCoreMigrations', () => {
  it('merges registered sources and keeps 0001_system_tables first', async () => {
    registerCoreMigrations({ zz_register_test_a: noop, aa_register_test_b: noop });
    const keys = Object.keys(allCoreMigrations());
    expect(keys[0]).toBe('0001_system_tables');
    expect(keys).toEqual([...keys].sort());
    expect(keys).toContain('zz_register_test_a');
    expect(keys).toContain('aa_register_test_b');
  });

  it('is a no-op when the same source object is registered again', () => {
    const src = { idem_register_test: noop };
    registerCoreMigrations(src);
    expect(() => registerCoreMigrations(src)).not.toThrow();
    expect(Object.keys(allCoreMigrations()).filter((k) => k === 'idem_register_test')).toHaveLength(1);
  });

  it('throws naming the key on a duplicate from a different object', () => {
    registerCoreMigrations({ dup_register_test: noop });
    expect(() => registerCoreMigrations({ dup_register_test: noop })).toThrow(/dup_register_test/);
  });

  it('throws when colliding with a built-in core migration', () => {
    expect(() => registerCoreMigrations({ '0001_system_tables': noop })).toThrow(/0001_system_tables/);
  });
});
