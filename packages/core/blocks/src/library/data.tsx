import { defineBlock } from '../define';
import { b } from '../fields';
import type { ResolvedEntry } from '../types';
import { CardBox, GRID_COLS, L, cn } from './ui';

const cell = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
};
const humanize = (k: string) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

/** Fields to show: the configured ones, else the first scalar fields of the entry. */
function visibleFields(entry: ResolvedEntry | undefined, fields: string[]): string[] {
  const chosen = fields.filter(Boolean);
  if (chosen.length || !entry) return chosen;
  return Object.keys(entry)
    .filter((k) => k !== 'documentId' && ['string', 'number'].includes(typeof entry[k]))
    .slice(0, 3);
}

export const EntryList = defineBlock({
  name: 'EntryList',
  label: L('Entry list', 'Danh sách mục', "Liste d'entrées", 'Daftar entri'),
  category: 'data',
  fields: {
    // The editor offers a content-type picker for this prop (custom field, Task 7); the plain text input is the fallback.
    apiId: b.text({ label: L('Content type (API ID)', 'Loại nội dung (API ID)', 'Type de contenu (ID API)', 'Tipe konten (API ID)') }),
    // The content type of `source` comes from the sibling `apiId` prop (apiIdFrom), so one block serves every type.
    source: b.entries('', { apiIdFrom: 'apiId', label: L('Entries', 'Các mục', 'Entrées', 'Entri'), limit: 12, sortable: true, filterable: true }),
    layout: b.select({
      label: L('Layout', 'Bố cục', 'Disposition', 'Tata letak'),
      options: [
        { value: 'list' as const, label: L('List', 'Danh sách', 'Liste', 'Daftar') },
        { value: 'grid' as const, label: L('Grid', 'Lưới', 'Grille', 'Grid') },
        { value: 'table' as const, label: L('Table', 'Bảng', 'Tableau', 'Tabel') },
      ],
      default: 'list',
    }),
    fields: b.list(
      { name: b.text({ label: L('Field', 'Trường', 'Champ', 'Bidang') }) },
      { label: L('Fields to show', 'Trường hiển thị', 'Champs à afficher', 'Bidang yang ditampilkan') },
    ),
  },
  render: ({ apiId, source, layout, fields }) => {
    if (!apiId || !source.length) return null;
    const names = visibleFields(source[0], fields.map((f) => f.name));
    if (!names.length) return null;
    const [title, ...rest] = names;

    if (layout === 'table') {
      return (
        <div className="w-full overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-muted-foreground">
              <tr>
                {names.map((n) => (
                  <th key={n} className="px-4 py-2 font-medium">{humanize(n)}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {source.map((e) => (
                <tr key={e.documentId}>
                  {names.map((n) => (
                    <td key={n} className="px-4 py-2">{cell(e[n])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    const body = (e: ResolvedEntry) => (
      <>
        <span className="font-semibold">{cell(e[title!])}</span>
        {rest.map((n) => (
          <span key={n} className="text-sm text-muted-foreground">{cell(e[n])}</span>
        ))}
      </>
    );
    if (layout === 'grid') {
      return (
        <div className={cn('grid gap-4', GRID_COLS[3])}>
          {source.map((e) => (
            <CardBox key={e.documentId} className="gap-1 px-6">{body(e)}</CardBox>
          ))}
        </div>
      );
    }
    return (
      <ul className="divide-y rounded-xl border">
        {source.map((e) => (
          <li key={e.documentId} className="flex flex-col gap-1 px-4 py-3">{body(e)}</li>
        ))}
      </ul>
    );
  },
});
