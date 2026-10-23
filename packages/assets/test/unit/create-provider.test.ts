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
  it('throws for s3/gcs until implemented', () => {
    expect(() => createProvider({ provider: 's3', s3: { bucket: 'b', region: 'r' } })).toThrow('S3 provider not available yet');
    expect(() => createProvider({ provider: 'gcs', gcs: { bucket: 'b' } })).toThrow(/GCS provider not available/);
  });
});
