/**
 * Search key of a string: lowercase, accents removed (NFD, combining marks stripped), `đ`/`Đ` → `d`. Used for
 * case- and accent-insensitive matching (`foldSearch(label).includes(foldSearch(query))`). Isomorphic.
 */
export function foldSearch(s: string): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();
}
