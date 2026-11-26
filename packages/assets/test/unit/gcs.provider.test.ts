import { describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
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

describe('createGcsProvider privateBucket', () => {
  it('puts, gets and deletes private objects in privateBucket', async () => {
    const pub = fakeBucket();
    const vault = fakeBucket();
    const stream = Readable.from([Buffer.from('x')]);
    vault.file.mockReturnValue({ save: vault.save, delete: vault.del, createReadStream: () => stream });
    const p = createGcsProvider({ bucket: 'pub', privateBucket: 'vault' }, { bucket: pub.bucket, privateBucket: vault.bucket });
    await p.put('private/order/1', Buffer.from('x'), 'application/pdf', 'private');
    expect(await p.get('private/order/1', 'private')).toBe(stream);
    await p.delete('private/order/1', 'private');
    expect(vault.file).toHaveBeenCalledTimes(3);
    expect(vault.file).toHaveBeenCalledWith('private/order/1');
    expect(vault.save).toHaveBeenCalledTimes(1);
    expect(vault.del).toHaveBeenCalledTimes(1);
    expect(pub.file).not.toHaveBeenCalled();
  });

  it('keeps public objects in the main bucket when privateBucket is set', async () => {
    const pub = fakeBucket();
    const vault = fakeBucket();
    const p = createGcsProvider({ bucket: 'pub', privateBucket: 'vault' }, { bucket: pub.bucket, privateBucket: vault.bucket });
    await p.put('a/b.webp', Buffer.from('x'), 'image/webp');
    await p.delete('a/b.webp', 'public');
    expect(pub.save).toHaveBeenCalledTimes(1);
    expect(pub.del).toHaveBeenCalledTimes(1);
    expect(vault.file).not.toHaveBeenCalled();
  });

  it('keeps private objects in the main bucket when privateBucket is not set', async () => {
    const pub = fakeBucket();
    const p = createGcsProvider({ bucket: 'pub' }, { bucket: pub.bucket });
    await p.put('private/order/1', Buffer.from('x'), 'application/pdf', 'private');
    expect(pub.file).toHaveBeenCalledWith('private/order/1');
    expect(pub.save).toHaveBeenCalledTimes(1);
  });
});
