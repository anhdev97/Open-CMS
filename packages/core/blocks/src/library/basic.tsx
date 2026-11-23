import { isValidElement, type ReactNode } from 'react';
import { defineBlock } from '../define';
import { b } from '../fields';
import { ALIGN, BadgePill, CardBox, JUSTIFY, L, LinkButton, cn } from './ui';

const alignField = (def: 'left' | 'center' | 'right' = 'left') =>
  b.select({
    label: L('Alignment', 'Căn lề', 'Alignement', 'Perataan'),
    options: [
      { value: 'left' as const, label: L('Left', 'Trái', 'Gauche', 'Kiri') },
      { value: 'center' as const, label: L('Center', 'Giữa', 'Centre', 'Tengah') },
      { value: 'right' as const, label: L('Right', 'Phải', 'Droite', 'Kanan') },
    ],
    default: def,
  });

const variantField = () =>
  b.select({
    label: L('Style', 'Kiểu', 'Style', 'Gaya'),
    options: [
      { value: 'default' as const, label: L('Primary', 'Chính', 'Principal', 'Utama') },
      { value: 'secondary' as const, label: L('Secondary', 'Phụ', 'Secondaire', 'Sekunder') },
      { value: 'outline' as const, label: L('Outline', 'Viền', 'Contour', 'Garis tepi') },
      { value: 'ghost' as const, label: L('Ghost', 'Nhẹ', 'Discret', 'Transparan') },
      { value: 'link' as const, label: L('Link', 'Liên kết', 'Lien', 'Tautan') },
    ],
    default: 'default',
  });

const HEADING_CLASS = {
  1: 'text-4xl font-bold tracking-tight sm:text-5xl',
  2: 'text-3xl font-semibold tracking-tight',
  3: 'text-2xl font-semibold tracking-tight',
  4: 'text-xl font-semibold',
  5: 'text-lg font-semibold',
  6: 'text-base font-semibold',
} as const;

export const Heading = defineBlock({
  name: 'Heading',
  label: L('Heading', 'Tiêu đề', 'Titre', 'Judul'),
  category: 'basic',
  fields: {
    text: b.text({ label: L('Text', 'Văn bản', 'Texte', 'Teks'), default: 'Heading' }),
    level: b.select({ label: L('Level', 'Cấp độ', 'Niveau', 'Tingkat'), options: [1, 2, 3, 4, 5, 6], default: 2 }),
    align: alignField(),
  },
  render: ({ text, level, align }) => {
    const Tag = `h${level}` as 'h1';
    return <Tag className={cn(HEADING_CLASS[level], ALIGN[align])}>{text}</Tag>;
  },
});

/** Puck turns `richtext` values into React elements before `render`; a bare string is shown as plain text, never as HTML. */
export const RichBody = ({ value, className }: { value: ReactNode | string; className?: string }) => {
  if (value === '' || value == null || value === false) return null;
  const body = isValidElement(value) ? value : <p>{value}</p>;
  return <div className={cn('space-y-4 leading-7 text-foreground [&_a]:text-primary [&_a]:underline [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6', className)}>{body}</div>;
};

export const Text = defineBlock({
  name: 'Text',
  label: L('Text', 'Đoạn văn', 'Texte', 'Teks'),
  category: 'basic',
  fields: {
    content: b.richText({ label: L('Content', 'Nội dung', 'Contenu', 'Konten'), default: '<p>Write something here.</p>' }),
    align: alignField(),
  },
  render: ({ content, align }) => <RichBody value={content} className={ALIGN[align]} />,
});

export const Image = defineBlock({
  name: 'Image',
  label: L('Image', 'Hình ảnh', 'Image', 'Gambar'),
  category: 'basic',
  fields: {
    image: b.image({ label: L('Image', 'Hình ảnh', 'Image', 'Gambar') }),
    rounded: b.boolean({ label: L('Rounded corners', 'Bo góc', 'Coins arrondis', 'Sudut membulat'), default: true }),
  },
  render: ({ image, rounded }) =>
    image?.src ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={image.src} alt={image.alt} width={image.width} height={image.height} loading="lazy" className={cn('h-auto w-full object-cover', rounded && 'rounded-xl')} />
    ) : null,
});

export const Button = defineBlock({
  name: 'Button',
  label: L('Button', 'Nút', 'Bouton', 'Tombol'),
  category: 'basic',
  fields: {
    label: b.text({ label: L('Label', 'Nhãn', 'Libellé', 'Label'), default: 'Click me' }),
    link: b.link({ label: L('Link', 'Liên kết', 'Lien', 'Tautan') }),
    variant: variantField(),
    size: b.select({
      label: L('Size', 'Kích thước', 'Taille', 'Ukuran'),
      options: [
        { value: 'sm' as const, label: L('Small', 'Nhỏ', 'Petit', 'Kecil') },
        { value: 'default' as const, label: L('Default', 'Mặc định', 'Par défaut', 'Bawaan') },
        { value: 'lg' as const, label: L('Large', 'Lớn', 'Grand', 'Besar') },
      ],
      default: 'default',
    }),
  },
  render: ({ label, link, variant, size }) => <LinkButton label={label} href={link?.href} variant={variant} size={size} />,
});

export const ButtonGroup = defineBlock({
  name: 'ButtonGroup',
  label: L('Button group', 'Nhóm nút', 'Groupe de boutons', 'Grup tombol'),
  category: 'basic',
  fields: {
    buttons: b.list(
      {
        label: b.text({ label: L('Label', 'Nhãn', 'Libellé', 'Label'), default: 'Button' }),
        link: b.link({ label: L('Link', 'Liên kết', 'Lien', 'Tautan') }),
        variant: variantField(),
      },
      {
        label: L('Buttons', 'Các nút', 'Boutons', 'Tombol'),
        max: 4,
        default: [
          { label: 'Get started', link: null, variant: 'default' },
          { label: 'Learn more', link: null, variant: 'outline' },
        ],
      },
    ),
    align: alignField(),
  },
  render: ({ buttons, align }) => (
    <div className={cn('flex flex-wrap gap-3', JUSTIFY[align])}>
      {buttons.map((x, i) => (
        <LinkButton key={i} label={x.label} href={x.link?.href} variant={x.variant} />
      ))}
    </div>
  ),
});

export const Card = defineBlock({
  name: 'Card',
  label: L('Card', 'Thẻ', 'Carte', 'Kartu'),
  category: 'basic',
  fields: {
    image: b.image({ label: L('Image', 'Hình ảnh', 'Image', 'Gambar') }),
    title: b.text({ label: L('Title', 'Tiêu đề', 'Titre', 'Judul'), default: 'Card title' }),
    description: b.longText({ label: L('Description', 'Mô tả', 'Description', 'Deskripsi'), default: 'A short description of this card.' }),
    link: b.link({ label: L('Link', 'Liên kết', 'Lien', 'Tautan') }),
    linkLabel: b.text({ label: L('Link label', 'Nhãn liên kết', 'Libellé du lien', 'Label tautan'), default: 'Learn more' }),
  },
  render: ({ image, title, description, link, linkLabel }) => (
    <CardBox className={image?.src ? 'pt-0' : undefined}>
      {image?.src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image.src} alt={image.alt} loading="lazy" className="aspect-video w-full object-cover" />
      ) : null}
      <div className="space-y-2 px-6">
        <h3 className="leading-none font-semibold">{title}</h3>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {link?.href && linkLabel ? (
        <div className="px-6">
          <LinkButton label={linkLabel} href={link.href} variant="outline" size="sm" />
        </div>
      ) : null}
    </CardBox>
  ),
});

export const Badge = defineBlock({
  name: 'Badge',
  label: L('Badge', 'Huy hiệu', 'Badge', 'Lencana'),
  category: 'basic',
  fields: {
    text: b.text({ label: L('Text', 'Văn bản', 'Texte', 'Teks'), default: 'New' }),
    variant: b.select({
      label: L('Style', 'Kiểu', 'Style', 'Gaya'),
      options: [
        { value: 'default' as const, label: L('Primary', 'Chính', 'Principal', 'Utama') },
        { value: 'secondary' as const, label: L('Secondary', 'Phụ', 'Secondaire', 'Sekunder') },
        { value: 'outline' as const, label: L('Outline', 'Viền', 'Contour', 'Garis tepi') },
        { value: 'destructive' as const, label: L('Destructive', 'Cảnh báo', 'Destructif', 'Destruktif') },
      ],
      default: 'default',
    }),
  },
  render: ({ text, variant }) => <BadgePill variant={variant}>{text}</BadgePill>,
});

