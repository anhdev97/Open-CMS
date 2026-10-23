const COMBINING_MARKS = /[\u0300-\u036f]/g;

export function slugifyFilename(
  originalName: string,
  extOverride?: string,
): { slug: string; ext: string } {
  const lastDot = originalName.lastIndexOf('.');
  const hasExt = lastDot > 0 && lastDot < originalName.length - 1;
  const baseName = hasExt ? originalName.slice(0, lastDot) : originalName;
  const extFromName = hasExt ? originalName.slice(lastDot + 1) : '';
  const ext = (extOverride ?? extFromName).replace(/^\./, '').toLowerCase();

  let slug = baseName
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  if (!slug) {
    slug = 'file';
  }

  return { slug, ext };
}
