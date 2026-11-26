/**
 * Content sniffing for private uploads (spec §7): the type of a file is decided from its bytes, never from its
 * extension or declared type.
 */

const startsWith = (buf: Buffer, sig: number[], at = 0): boolean =>
  buf.length >= at + sig.length && sig.every((b, i) => buf[at + i] === b);

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** How many leading bytes the plain-text heuristic looks at. */
const TEXT_PROBE = 8192;

function sniffZip(buf: Buffer): string {
  // File names are stored uncompressed in the local headers and the central directory.
  if (buf.includes('[Content_Types].xml')) {
    if (buf.includes('word/')) return DOCX;
    if (buf.includes('xl/')) return XLSX;
    if (buf.includes('ppt/')) return PPTX;
  }
  return 'application/zip';
}

function sniffOle(buf: Buffer): string {
  // Directory entry names are UTF-16LE.
  if (buf.includes(Buffer.from('WordDocument', 'utf16le'))) return 'application/msword';
  if (buf.includes(Buffer.from('Workbook', 'utf16le')) || buf.includes(Buffer.from('Book', 'utf16le'))) return 'application/vnd.ms-excel';
  if (buf.includes(Buffer.from('PowerPoint Document', 'utf16le'))) return 'application/vnd.ms-powerpoint';
  return 'application/x-ole-storage';
}

function looksLikeText(buf: Buffer): boolean {
  let probe = buf.subarray(0, TEXT_PROBE);
  // Do not fail on a multi-byte character cut by the probe boundary: drop an incomplete trailing sequence.
  if (buf.length > TEXT_PROBE) {
    let i = probe.length - 1;
    let back = 0;
    while (i >= 0 && back < 3 && (probe[i]! & 0xc0) === 0x80) {
      i--;
      back++;
    }
    if (i >= 0 && probe[i]! >= 0xc0) probe = probe.subarray(0, i);
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(probe);
  } catch {
    return false;
  }
  for (const b of probe) {
    // Control bytes other than tab, LF, FF, CR and ESC mean binary.
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0c && b !== 0x0d && b !== 0x1b) return false;
    if (b === 0x7f) return false;
  }
  return true;
}

/**
 * The MIME type of `buf` from its leading bytes: PDF, PNG, JPEG, GIF, WEBP, DOCX/XLSX/PPTX, ZIP, DOC/XLS/PPT (OLE),
 * else `text/plain` for valid UTF-8 without control bytes, else null (unknown).
 */
export function sniffMime(buf: Buffer): string | null {
  if (!buf || buf.length === 0) return null;
  if (startsWith(buf, ascii('%PDF-'))) return 'application/pdf';
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(buf, ascii('GIF87a')) || startsWith(buf, ascii('GIF89a'))) return 'image/gif';
  if (startsWith(buf, ascii('RIFF')) && startsWith(buf, ascii('WEBP'), 8)) return 'image/webp';
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buf, [0x50, 0x4b, 0x05, 0x06])) return sniffZip(buf);
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return sniffOle(buf);
  return looksLikeText(buf) ? 'text/plain' : null;
}

/** Whether `mime` satisfies an `accept` list (`type/subtype`, `type/*`, `*\/*`). No list = any known type. */
export function acceptsMime(accept: readonly string[] | undefined | null, mime: string | null): boolean {
  if (!mime) return false;
  if (!accept?.length) return true;
  const m = mime.toLowerCase();
  return accept.some((a) => {
    const p = a.trim().toLowerCase();
    if (p === '*/*') return true;
    if (p.endsWith('/*')) return m.startsWith(p.slice(0, -1));
    return p === m;
  });
}

/** Text formats that sniff as `text/plain`; a declared one of these is kept when the field accepts it. */
const TEXT_LIKE = /^(text\/[\w.+-]+|application\/(json|xml|csv))$/;

/** Types a browser would render or run (markup, scripts in SVG/XML): private files are never stored with these. */
const ACTIVE = new Set(['text/html', 'application/xhtml+xml', 'image/svg+xml', 'text/xml', 'application/xml', 'text/javascript', 'application/javascript']);

/**
 * The stored type of an upload into a field with `accept`, or null when it is not acceptable. Binary formats must
 * sniff to an accepted type. Plain text cannot be told apart further, so a declared text-like type (`text/csv`,
 * `application/json`, …) is used when the field accepts it. Active types (HTML, XHTML, SVG, XML, JavaScript) are
 * always stored as `text/plain`.
 */
export function resolveUploadMime(buf: Buffer, declared: string | null | undefined, accept?: readonly string[] | null): string | null {
  const sniffed = sniffMime(buf);
  let out: string | null = null;
  if (sniffed === 'text/plain') {
    const d = (declared ?? '').split(';')[0]!.trim().toLowerCase();
    if (d && d !== 'text/plain' && (TEXT_LIKE.test(d) || ACTIVE.has(d)) && acceptsMime(accept, d)) out = d;
  }
  if (!out && sniffed && acceptsMime(accept, sniffed)) out = sniffed;
  if (!out && !sniffed && (!accept?.length || accept.some((a) => a.trim() === '*/*'))) out = 'application/octet-stream';
  return out && ACTIVE.has(out) ? 'text/plain' : out;
}
