import { describe, expect, it, vi } from 'vitest';
import { createGcsProvider } from '../../src/provider/gcs.provider';

function fakeBucket() {
  const save = vi.fn().mockResolvedValue(undefined);
  const del = vi.fn().mockResolvedValue(undefined);
  const file = vi.fn().mockReturnValue({ save, delete: del });
  return { bucket: { file }, file, save, del };
}

describe('createGcsProvider', () => {
  it('saves and deletes objects', async () => {
    const f = fakeBucket();
    const p = createGcsProvider({ bucket: 'bkt' }, { bucket: f.bucket });
    expect(p.kind).toBe('gcs');
    const body = Buffer.from('x');
    await p.put('a/b.webp', body, 'image/webp');
    expect(f.file).toHaveBeenCalledWith('a/b.webp');
    expect(f.save).toHaveBeenCalledWith(body, { contentType: 'image/webp', resumable: false });
    await p.delete('a/b.webp');
    expect(f.del).toHaveBeenCalledWith({ ignoreNotFound: true });
  });
  it('builds default public URL', () => {
    const p = createGcsProvider({ bucket: 'bkt' }, { bucket: fakeBucket().bucket });
    expect(p.publicUrl('a/b.webp')).toBe('https://storage.googleapis.com/bkt/a/b.webp');
  });
  it('prefers publicBaseUrl', () => {
    const p = createGcsProvider({ bucket: 'bkt', publicBaseUrl: 'https://cdn.example.com/' }, { bucket: fakeBucket().bucket });
    expect(p.publicUrl('k.png')).toBe('https://cdn.example.com/k.png');
  });
});
