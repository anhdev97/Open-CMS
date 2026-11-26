import { describe, expect, it } from 'vitest';
import { assertValidSchema, collectSchemaIssues, defineContentType, f, normalizeDefinition } from '../src';

const base = { id: 'ct_o', apiId: 'order', displayName: 'Order', fields: { code: f.text({ id: 'fld_c' }) } };

describe('private content types and readOnly fields', () => {
  it('stores private only when true and keeps it through normalizeDefinition', () => {
    expect(defineContentType({ ...base, private: true }).private).toBe(true);
    expect('private' in defineContentType({ ...base, private: false })).toBe(false);
    expect('private' in defineContentType(base)).toBe(false);
    expect(normalizeDefinition(defineContentType({ ...base, private: true })).private).toBe(true);
  });

  it('stores readOnly on a field only when true', () => {
    const def = defineContentType({ ...base, fields: { a: f.json({ id: 'fld_a', readOnly: true }), b: f.text({ id: 'fld_b' }) } });
    expect(def.fields[0].readOnly).toBe(true);
    expect('readOnly' in def.fields[1]).toBe(false);
    expect(normalizeDefinition(def).fields[0].readOnly).toBe(true);
    expect(def.fields[0].options).toEqual({});
  });

  it('rejects private + review', () => {
    expect(() => assertValidSchema([defineContentType({ ...base, private: true, review: true })])).toThrow('private type cannot use review');
  });

  it('rejects private + localizable fields; non-localizable is the default', () => {
    const bad = defineContentType({ ...base, private: true, fields: { t: f.text({ id: 'fld_t', localizable: true }) } });
    expect(() => assertValidSchema([bad])).toThrow('private type cannot have localizable fields');
    expect(collectSchemaIssues([defineContentType({ ...base, private: true })])).toEqual([]);
  });

  it('rejects a public type referencing a private type, allows the reverse and private->private', () => {
    const order = defineContentType({ ...base, private: true });
    const ref = (apiId: string, priv = false) =>
      defineContentType({ id: `ct_${apiId}`, apiId, displayName: apiId, private: priv, fields: { o: f.reference({ id: 'fld_o', target: 'order' }) } });
    expect(collectSchemaIssues([order, ref('page')]).join()).toContain('public type cannot reference private type "order"');
    expect(collectSchemaIssues([order, ref('invoice', true)])).toEqual([]);
    const pub = defineContentType({ id: 'ct_p', apiId: 'pub', displayName: 'P', fields: {} });
    const privRefPub = defineContentType({ id: 'ct_q', apiId: 'q', displayName: 'Q', private: true, fields: { p: f.reference({ id: 'fld_p', target: 'pub' }) } });
    expect(collectSchemaIssues([pub, privRefPub])).toEqual([]);
  });
});
