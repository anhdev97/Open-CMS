import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { diffSchemas, loadConfig, loadContentGroups, loadDefinitions, readSnapshot } from '@opencloudcms/codegen';
import { collectSchemaIssues } from '@opencloudcms/schema';

// The my-store example ships a private `order` type (spec 2026-11-25 §7): server-written totals and items, a private
// invoice PDF, never served publicly.
const root = path.resolve(__dirname, '../../../../examples/my-store');

describe('examples/my-store order type', () => {
  it('is private with readOnly items and total, a PDF invoice, and validates with the other types', async () => {
    const config = await loadConfig(root);
    const defs = (await loadDefinitions(config)).map((d) => d.def);
    const order = defs.find((d) => d.apiId === 'order');
    expect(order?.private).toBe(true);
    expect(order?.review).toBeFalsy();
    const field = (name: string) => order!.fields.find((x) => x.name === name);
    expect(field('code')).toMatchObject({ kind: 'text', required: true, unique: true });
    expect(field('orderStatus')).toMatchObject({ kind: 'text', required: true });
    expect(field('items')).toMatchObject({ kind: 'json', readOnly: true });
    expect(field('total')).toMatchObject({ kind: 'money', readOnly: true });
    expect(field('invoice')).toMatchObject({ kind: 'asset', options: { accept: ['application/pdf'] } });
    expect(order!.fields.some((x) => x.localizable)).toBe(false);
    expect(collectSchemaIssues(defs, await loadContentGroups(config))).toEqual([]);
  });

  it('has its migration: the snapshot matches the schema files', async () => {
    const config = await loadConfig(root);
    const defs = (await loadDefinitions(config)).map((d) => d.def);
    const { changed, operations } = diffSchemas(readSnapshot(config.migrationsDir).contentTypes, defs);
    expect(operations).toEqual([]);
    expect(changed).toBe(false);
  });
});
