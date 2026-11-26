import { describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
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

describe('createS3Provider privateBucket', () => {
  const cmds = (send: ReturnType<typeof vi.fn>) => send.mock.calls.map((c) => c[0] as { constructor: { name: string }; input: { Bucket: string; Key: string } });

  it('puts, gets and deletes private objects in privateBucket', async () => {
    const send = vi.fn().mockResolvedValue({ Body: Readable.from([Buffer.from('x')]) });
    const p = createS3Provider({ bucket: 'pub', region: 'r', privateBucket: 'vault' }, { client: { send } });
    await p.put('private/order/1', Buffer.from('x'), 'application/pdf', 'private');
    await p.get('private/order/1', 'private');
    await p.delete('private/order/1', 'private');
    expect(cmds(send).map((c) => [c.constructor.name, c.input.Bucket, c.input.Key])).toEqual([
      ['PutObjectCommand', 'vault', 'private/order/1'],
      ['GetObjectCommand', 'vault', 'private/order/1'],
      ['DeleteObjectCommand', 'vault', 'private/order/1'],
    ]);
  });

  it('keeps public objects in the main bucket when privateBucket is set', async () => {
    const send = vi.fn().mockResolvedValue({});
    const p = createS3Provider({ bucket: 'pub', region: 'r', privateBucket: 'vault' }, { client: { send } });
    await p.put('a/b.webp', Buffer.from('x'), 'image/webp');
    await p.delete('a/b.webp', 'public');
    expect(cmds(send).map((c) => c.input.Bucket)).toEqual(['pub', 'pub']);
  });

  it('keeps private objects in the main bucket when privateBucket is not set', async () => {
    const send = vi.fn().mockResolvedValue({});
    const p = createS3Provider({ bucket: 'pub', region: 'r' }, { client: { send } });
    await p.put('private/order/1', Buffer.from('x'), 'application/pdf', 'private');
    await p.delete('private/order/1', 'private');
    expect(cmds(send).map((c) => c.input.Bucket)).toEqual(['pub', 'pub']);
  });
});
