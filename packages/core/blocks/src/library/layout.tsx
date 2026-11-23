import { defineBlock } from '../define';
import { b } from '../fields';
import { BG, COLS, GAP, GRID_COLS, H, L, MY, PY } from './ui';

export const background = () =>
  b.color({ label: L('Background', 'Nền', 'Arrière-plan', 'Latar belakang'), default: 'background' });
export const gap = () => b.spacing({ label: L('Gap', 'Khoảng cách', 'Espacement', 'Jarak'), default: '6' });

export const Section = defineBlock({
  name: 'Section',
  label: L('Section', 'Khối nội dung', 'Section', 'Bagian'),
  category: 'layout',
  fields: {
    background: background(),
    paddingY: b.spacing({ label: L('Vertical padding', 'Đệm dọc', 'Marge verticale', 'Padding vertikal'), default: '12' }),
    children: b.slot({ label: L('Content', 'Nội dung', 'Contenu', 'Konten') }),
  },
  render: ({ background, paddingY, children }) => (
    <section className={`${BG[background]} ${PY[paddingY]}`}>
      <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">{children}</div>
    </section>
  ),
});

export const Columns = defineBlock({
  name: 'Columns',
  label: L('Columns', 'Cột', 'Colonnes', 'Kolom'),
  category: 'layout',
  fields: {
    columns: b.select({ label: L('Columns', 'Số cột', 'Colonnes', 'Jumlah kolom'), options: [2, 3, 4], default: 2 }),
    gap: gap(),
    column1: b.slot({ label: L('Column 1', 'Cột 1', 'Colonne 1', 'Kolom 1') }),
    column2: b.slot({ label: L('Column 2', 'Cột 2', 'Colonne 2', 'Kolom 2') }),
    column3: b.slot({ label: L('Column 3', 'Cột 3', 'Colonne 3', 'Kolom 3') }),
    column4: b.slot({ label: L('Column 4', 'Cột 4', 'Colonne 4', 'Kolom 4') }),
  },
  render: ({ columns, gap, column1, column2, column3, column4 }) => (
    <div className={`grid ${COLS[columns]} ${GAP[gap]}`}>
      {[column1, column2, column3, column4].slice(0, columns).map((c, i) => (
        <div key={i} className="min-w-0">{c}</div>
      ))}
    </div>
  ),
});

export const Grid = defineBlock({
  name: 'Grid',
  label: L('Grid', 'Lưới', 'Grille', 'Grid'),
  category: 'layout',
  fields: {
    columns: b.select({ label: L('Columns', 'Số cột', 'Colonnes', 'Jumlah kolom'), options: [2, 3, 4], default: 3 }),
    gap: gap(),
    children: b.slot({ label: L('Items', 'Mục', 'Éléments', 'Item') }),
  },
  render: ({ columns, gap, children }) => <div className={`grid ${GRID_COLS[columns]} ${GAP[gap]}`}>{children}</div>,
});

export const Spacer = defineBlock({
  name: 'Spacer',
  label: L('Spacer', 'Khoảng trống', 'Espaceur', 'Spasi'),
  category: 'layout',
  fields: {
    size: b.spacing({ label: L('Height', 'Chiều cao', 'Hauteur', 'Tinggi'), default: '8' }),
  },
  render: ({ size }) => <div aria-hidden="true" className={H[size]} />,
});

export const Divider = defineBlock({
  name: 'Divider',
  label: L('Divider', 'Đường kẻ', 'Séparateur', 'Pemisah'),
  category: 'layout',
  fields: {
    margin: b.spacing({ label: L('Vertical margin', 'Lề dọc', 'Marge verticale', 'Margin vertikal'), default: '4' }),
  },
  render: ({ margin }) => <hr className={`border-border ${MY[margin]}`} />,
});
