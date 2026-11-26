import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { acceptsMime, sniffMime } from '../src/sniff';

const PDF = Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n1 0 obj\n<< /Type /Catalog >>\nendobj\n', 'latin1');

/** A minimal ZIP: one local file header per name (stored, empty) — enough for the name scan. */
function zip(names: string[]): Buffer {
  const parts: Buffer[] = [];
  for (const name of names) {
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(Buffer.byteLength(name), 26);
    parts.push(h, Buffer.from(name));
  }
  return Buffer.concat(parts);
}

function ole(stream: string): Buffer {
  const head = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  return Buffer.concat([head, Buffer.alloc(504), Buffer.from(stream, 'utf16le'), Buffer.alloc(64)]);
}

describe('sniffMime', () => {
  it('detects a PDF from its bytes', () => {
    expect(sniffMime(PDF)).toBe('application/pdf');
  });

  it('detects a PNG even when it is named and declared as a PDF; the field accept rejects it', async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#000' } }).png().toBuffer();
    // The filename "invoice.pdf" and declared type "application/pdf" play no part in sniffing.
    const sniffed = sniffMime(png);
    expect(sniffed).toBe('image/png');
    expect(acceptsMime(['application/pdf'], sniffed)).toBe(false);
    expect(acceptsMime(['application/pdf'], sniffMime(PDF))).toBe(true);
  });

  it('detects JPEG, GIF and WEBP', async () => {
    const img = sharp({ create: { width: 2, height: 2, channels: 3, background: '#0f0' } });
    expect(sniffMime(await img.clone().jpeg().toBuffer())).toBe('image/jpeg');
    expect(sniffMime(await img.clone().gif().toBuffer())).toBe('image/gif');
    expect(sniffMime(await img.clone().webp().toBuffer())).toBe('image/webp');
  });

  it('detects DOCX, XLSX and a plain ZIP', () => {
    expect(sniffMime(zip(['[Content_Types].xml', 'word/document.xml']))).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(sniffMime(zip(['[Content_Types].xml', 'xl/workbook.xml']))).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(sniffMime(zip(['readme.txt']))).toBe('application/zip');
  });

  it('detects DOC (OLE with a WordDocument stream) and other OLE files', () => {
    expect(sniffMime(ole('WordDocument'))).toBe('application/msword');
    expect(sniffMime(ole('Workbook'))).toBe('application/vnd.ms-excel');
    expect(sniffMime(ole('Other'))).toBe('application/x-ole-storage');
  });

  it('treats valid UTF-8 without control bytes as text/plain; binary and empty input are unknown', () => {
    expect(sniffMime(Buffer.from('id,name\n1,Café\n'))).toBe('text/plain');
    expect(sniffMime(Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]))).toBeNull();
    expect(sniffMime(Buffer.from([0x41, 0x00, 0x42]))).toBeNull();
    expect(sniffMime(Buffer.alloc(0))).toBeNull();
  });
});

describe('acceptsMime', () => {
  it('matches exact types and wildcards; no accept list accepts anything known', () => {
    expect(acceptsMime(['image/*'], 'image/png')).toBe(true);
    expect(acceptsMime(['image/*'], 'application/pdf')).toBe(false);
    expect(acceptsMime(['*/*'], 'application/pdf')).toBe(true);
    expect(acceptsMime(undefined, 'application/pdf')).toBe(true);
    expect(acceptsMime([], 'application/pdf')).toBe(true);
    expect(acceptsMime(['application/pdf'], null)).toBe(false);
  });
});
