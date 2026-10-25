import { describe, expect, it, vi } from 'vitest';
import { createS3Provider } from '../../src/provider/s3.provider';

describe('createS3Provider', () => {
  it('sends PutObject and DeleteObject commands', async () => {
    const send = vi.fn().mockResolvedValue({});
    const p = createS3Provider({ bucket: 'bkt', region: 'eu-west-1' }, { client: { send } });
    expect(p.kind).toBe('s3');
    await p.put('a/b.webp', Buffer.from('x'), 'image/webp');
    await p.delete('a/b.webp');
    expect(send).toHaveBeenCalledTimes(2);
    const [put, del] = send.mock.calls.map((c) => c[0]);
    expect(put.constructor.name).toBe('PutObjectCommand');
    expect(put.input).toMatchObject({ Bucket: 'bkt', Key: 'a/b.webp', ContentType: 'image/webp' });
    expect(Buffer.isBuffer(put.input.Body)).toBe(true);
    expect(del.constructor.name).toBe('DeleteObjectCommand');
    expect(del.input).toEqual({ Bucket: 'bkt', Key: 'a/b.webp' });
  });
  it('propagates client errors', async () => {
    const send = vi.fn().mockRejectedValue(new Error('boom'));
    const p = createS3Provider({ bucket: 'b', region: 'r' }, { client: { send } });
    await expect(p.put('k', Buffer.from('x'), 'image/png')).rejects.toThrow('boom');
  });
  it('builds default public URL', () => {
    const p = createS3Provider({ bucket: 'bkt', region: 'eu-west-1' }, { client: { send: vi.fn() } });
    expect(p.publicUrl('a/b.webp')).toBe('https://bkt.s3.eu-west-1.amazonaws.com/a/b.webp');
  });
  it('prefers publicBaseUrl and trims trailing slash', () => {
    const p = createS3Provider(
      { bucket: 'bkt', region: 'r', publicBaseUrl: 'https://cdn.example.com/' },
      { client: { send: vi.fn() } },
    );
    expect(p.publicUrl('a/b.webp')).toBe('https://cdn.example.com/a/b.webp');
  });
});
