export function missingAlt(asset: {
  mimeType?: string | null;
  alt?: string | null;
}): boolean {
  const mime = asset.mimeType ?? '';
  if (!mime.startsWith('image/')) {
    return false;
  }
  return !asset.alt?.trim();
}
