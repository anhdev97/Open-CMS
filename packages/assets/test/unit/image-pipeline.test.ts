import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_PIXELS } from '../../src/constants';
import { processUpload } from '../../src/pipeline/image-pipeline';

const now = new Date('2026-03-05T10:00:00Z');

async function png(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } },
  })
    .png()
    .toBuffer();
}

describe('processUpload', () => {
  it('returns only original for a 1x1 PNG', async () => {
    const res = await processUpload(
      { buffer: await png(1, 1), originalFilename: 'Tiny.PNG', mimeType: 'image/png' },
      { now, shortId: 'abcd' },
    );
    expect(res.objects.map((o) => o.kind)).toEqual(['original']);
    expect(res.filename).toBe('tiny.webp');
    expect(res.mimeType).toBe('image/webp');
    expect(res.storageKey).toBe('2026/03/tiny-abcd.webp');
    const [orig] = res.objects;
    expect(orig.key).toBe(res.storageKey);
    expect(orig.contentType).toBe('image/webp');
    expect(orig.width).toBe(1);
    expect(orig.height).toBe(1);
    expect((await sharp(orig.body).metadata()).format).toBe('webp');
  });

  it('creates thumb only for ~400px wide image', async () => {
    const res = await processUpload(
      { buffer: await png(400, 200), originalFilename: 'Ảnh Sản Phẩm.png', mimeType: 'image/png' },
      { now, shortId: 'ab12' },
    );
    expect(res.objects.map((o) => o.kind)).toEqual(['original', 'thumb']);
    expect(res.filename).toBe('anh-san-pham.webp');
    const thumb = res.objects[1];
    expect(thumb.key).toBe('2026/03/anh-san-pham-ab12_thumb.webp');
    expect(thumb.width).toBe(320);
    expect(thumb.height).toBe(160);
    expect(thumb.contentType).toBe('image/webp');
  });

  it('creates all variants for large images and honours custom sizes', async () => {
    const res = await processUpload(
      { buffer: await png(500, 500), originalFilename: 'big.jpg', mimeType: 'image/jpeg' },
      { now, shortId: 'ffff', sizes: { thumb: 100, medium: 200, large: 300 } },
    );
    expect(res.objects.map((o) => o.kind)).toEqual(['original', 'thumb', 'medium', 'large']);
    expect(res.objects.map((o) => o.width)).toEqual([500, 100, 200, 300]);
    expect(res.objects[3].key).toBe('2026/03/big-ffff_large.webp');
  });

  it('generates a 4-hex shortId by default', async () => {
    const res = await processUpload(
      { buffer: await png(1, 1), originalFilename: 'a.png', mimeType: 'image/png' },
      { now },
    );
    expect(res.storageKey).toMatch(/^2026\/03\/a-[0-9a-f]{4}\.webp$/);
  });

  it('passes through PDFs as a single object', async () => {
    const buffer = Buffer.from('%PDF-1.4 fake');
    const res = await processUpload(
      { buffer, originalFilename: 'Báo Cáo.PDF', mimeType: 'application/pdf' },
      { now, shortId: 'ab12' },
    );
    expect(res.objects).toHaveLength(1);
    expect(res.mimeType).toBe('application/pdf');
    expect(res.filename).toBe('bao-cao.pdf');
    expect(res.storageKey).toBe('2026/03/bao-cao-ab12.pdf');
    expect(res.objects[0]).toMatchObject({
      kind: 'original',
      key: res.storageKey,
      contentType: 'application/pdf',
    });
    expect(res.objects[0].body.equals(buffer)).toBe(true);
  });

  it('treats SVG as non-transform single object', async () => {
    const buffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const res = await processUpload(
      { buffer, originalFilename: 'logo.svg', mimeType: 'image/svg+xml' },
      { now, shortId: 'ab12' },
    );
    expect(res.objects).toHaveLength(1);
    expect(res.mimeType).toBe('image/svg+xml');
    expect(res.storageKey).toBe('2026/03/logo-ab12.svg');
    expect(res.objects[0].body.equals(buffer)).toBe(true);
  });

  it('rejects images exceeding MAX_IMAGE_PIXELS with code image_too_large', async () => {
    // 1 x (MAX+1) would be huge in height; use a wide-but-thin image within sharp limits.
    const width = 20_000;
    const height = Math.floor(MAX_IMAGE_PIXELS / width) + 1;
    const buffer = await sharp({
      create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    await expect(
      processUpload({ buffer, originalFilename: 'huge.png', mimeType: 'image/png' }, { now }),
    ).rejects.toMatchObject({ code: 'image_too_large' });
  });

  it('uses max edge for portrait images (300x1500 gets thumb+medium only)', async () => {
    const res = await processUpload(
      { buffer: await png(300, 1500), originalFilename: 'tall.png', mimeType: 'image/png' },
      { now, shortId: 'ab12' },
    );
    expect(res.objects.map((o) => o.kind)).toEqual(['original', 'thumb', 'medium']);
    expect(Math.max(res.objects[1].width!, res.objects[1].height!)).toBe(320);
    expect(Math.max(res.objects[2].width!, res.objects[2].height!)).toBe(1280);
  });

  it('skips variants when max edge <= target (portrait 300x500)', async () => {
    const res = await processUpload(
      { buffer: await png(300, 500), originalFilename: 'p.png', mimeType: 'image/png' },
      { now, shortId: 'ab12', sizes: { thumb: 320, medium: 500, large: 1600 } },
    );
    expect(res.objects.map((o) => o.kind)).toEqual(['original', 'thumb']);
  });

  it('constrains the max edge of portrait variants (1000x4000 thumb is 80x320)', async () => {
    const res = await processUpload(
      { buffer: await png(1000, 4000), originalFilename: 'tall.png', mimeType: 'image/png' },
      { now, shortId: 'ab12' },
    );
    const thumb = res.objects.find((o) => o.kind === 'thumb');
    expect(thumb).toBeDefined();
    expect(Math.max(thumb!.width!, thumb!.height!)).toBe(320);
    for (const o of res.objects.filter((x) => x.kind !== 'original')) {
      const target = { thumb: 320, medium: 1280, large: 1920 }[o.kind as 'thumb'];
      expect(Math.max(o.width!, o.height!)).toBeLessThanOrEqual(target ?? Infinity);
    }
  });

  it('sanitizes malicious extensions on pass-through files', async () => {
    const buffer = Buffer.from('x');
    const evil = await processUpload(
      { buffer, originalFilename: 'a.p/../../etc', mimeType: 'application/octet-stream' },
      { now, shortId: 'ab12' },
    );
    expect(evil.storageKey).toBe('2026/03/a-p-ab12.bin');
    expect(evil.filename).toBe('a-p.bin');

    const long = await processUpload(
      { buffer, originalFilename: 'doc.abcdefghijklmnop', mimeType: 'application/octet-stream' },
      { now, shortId: 'ab12' },
    );
    expect(long.storageKey).toBe('2026/03/doc-ab12.bin');

    const weird = await processUpload(
      { buffer, originalFilename: 'doc.ex e<>', mimeType: 'application/octet-stream' },
      { now, shortId: 'ab12' },
    );
    expect(weird.storageKey).toMatch(/^2026\/03\/doc-ab12\.bin$/);
    expect(weird.storageKey).not.toContain('..');
  });

  it('keeps valid extensions on pass-through files', async () => {
    const res = await processUpload(
      { buffer: Buffer.from('x'), originalFilename: 'a.tar7z', mimeType: 'application/zip' },
      { now, shortId: 'ab12' },
    );
    expect(res.storageKey).toBe('2026/03/a-ab12.tar7z');
  });

  it('treats SVG with charset param as non-transform and normalizes mime', async () => {
    const buffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const res = await processUpload(
      { buffer, originalFilename: 'logo.svg', mimeType: 'Image/SVG+XML; charset=utf-8' },
      { now, shortId: 'ab12' },
    );
    expect(res.objects).toHaveLength(1);
    expect(res.mimeType).toBe('image/svg+xml');
    expect(res.objects[0].contentType).toBe('image/svg+xml');
    expect(res.storageKey).toBe('2026/03/logo-ab12.svg');
  });

  it('normalizes mime params for raster images', async () => {
    const res = await processUpload(
      { buffer: await png(1, 1), originalFilename: 'a.png', mimeType: 'IMAGE/PNG; foo=bar' },
      { now, shortId: 'ab12' },
    );
    expect(res.mimeType).toBe('image/webp');
  });

  it('throws invalid_image for a corrupt buffer', async () => {
    await expect(
      processUpload(
        { buffer: Buffer.from('not an image'), originalFilename: 'bad.png', mimeType: 'image/png' },
        { now },
      ),
    ).rejects.toMatchObject({ code: 'invalid_image' });
  });

  it('throws invalid_image when a dimension exceeds the WebP limit (16383)', async () => {
    const buffer = await sharp({
      create: { width: 16_384, height: 1, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
    await expect(
      processUpload({ buffer, originalFilename: 'wide.png', mimeType: 'image/png' }, { now }),
    ).rejects.toMatchObject({ code: 'invalid_image' });
  });
});
