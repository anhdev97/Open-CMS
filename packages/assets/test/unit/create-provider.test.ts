import { describe, expect, it } from 'vitest';
import { createProvider } from '../../src/provider/create-provider';

describe('createProvider', () => {
  it('creates a local provider', () => {
    const p = createProvider({ provider: 'local', local: { root: '/tmp/x', publicBaseUrl: 'http://h/uploads/' } });
    expect(p.kind).toBe('local');
    expect(p.publicUrl('a/b.webp')).toBe('http://h/uploads/a/b.webp');
  });
  it('throws on incomplete local config', () => {
    expect(() => createProvider({ provider: 'local' })).toThrow(/local/);
  });
  it('creates an s3 provider', () => {
    const p = createProvider({ provider: 's3', s3: { bucket: 'b', region: 'us-east-1' } });
    expect(p.kind).toBe('s3');
    expect(p.publicUrl('k.png')).toBe('https://b.s3.us-east-1.amazonaws.com/k.png');
  });
  it('creates a gcs provider', () => {
    const p = createProvider({ provider: 'gcs', gcs: { bucket: 'b' } });
    expect(p.kind).toBe('gcs');
    expect(p.publicUrl('k.png')).toBe('https://storage.googleapis.com/b/k.png');
  });
  it('throws on incomplete s3/gcs config', () => {
    expect(() => createProvider({ provider: 's3' })).toThrow(/s3/);
    expect(() => createProvider({ provider: 's3', s3: { bucket: 'b' } as never })).toThrow(/region/);
    expect(() => createProvider({ provider: 'gcs' })).toThrow(/gcs/);
  });
});
