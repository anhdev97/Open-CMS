import { defineBlock } from '../define';
import { b } from '../fields';
import { ALIGN, BG, BadgePill, CardBox, GRID_COLS, JUSTIFY, L, LinkButton, PY, cn } from './ui';

const text = (label: ReturnType<typeof L>, def = '') => b.text({ label, default: def });
const alignField = () =>
  b.select({
    label: L('Alignment', 'Căn lề', 'Alignement', 'Perataan'),
    options: [
      { value: 'left' as const, label: L('Left', 'Trái', 'Gauche', 'Kiri') },
      { value: 'center' as const, label: L('Center', 'Giữa', 'Centre', 'Tengah') },
    ],
    default: 'center',
  });

export const Hero = defineBlock({
  name: 'Hero',
  label: L('Hero', 'Ảnh bìa', 'Bannière', 'Hero'),
  category: 'marketing',
  fields: {
    badge: text(L('Badge', 'Huy hiệu', 'Badge', 'Lencana')),
    heading: text(L('Heading', 'Tiêu đề', 'Titre', 'Judul'), 'Build something people love'),
    subheading: b.longText({
      label: L('Subheading', 'Tiêu đề phụ', 'Sous-titre', 'Subjudul'),
      default: 'A short sentence that explains what you offer and why it matters.',
    }),
    primaryLabel: text(L('Primary button label', 'Nhãn nút chính', 'Bouton principal', 'Label tombol utama'), 'Get started'),
    primaryLink: b.link({ label: L('Primary button link', 'Liên kết nút chính', 'Lien du bouton principal', 'Tautan tombol utama') }),
    secondaryLabel: text(L('Secondary button label', 'Nhãn nút phụ', 'Bouton secondaire', 'Label tombol sekunder')),
    secondaryLink: b.link({ label: L('Secondary button link', 'Liên kết nút phụ', 'Lien du bouton secondaire', 'Tautan tombol sekunder') }),
    image: b.image({ label: L('Image', 'Hình ảnh', 'Image', 'Gambar') }),
    align: alignField(),
    background: b.color({ label: L('Background', 'Nền', 'Arrière-plan', 'Latar belakang'), default: 'muted' }),
  },
  render: (p) => (
    <section className={cn(BG[p.background], 'py-16 sm:py-24')}>
      <div className={cn('mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 sm:px-6', ALIGN[p.align], p.align === 'center' && 'items-center')}>
        {p.badge ? <BadgePill variant="secondary">{p.badge}</BadgePill> : null}
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">{p.heading}</h1>
        {p.subheading ? <p className="max-w-2xl text-lg text-muted-foreground">{p.subheading}</p> : null}
        {p.primaryLabel || p.secondaryLabel ? (
          <div className={cn('flex flex-wrap gap-3', p.align === 'center' ? JUSTIFY.center : JUSTIFY.left)}>
            {p.primaryLabel ? <LinkButton label={p.primaryLabel} href={p.primaryLink?.href} size="lg" /> : null}
            {p.secondaryLabel ? <LinkButton label={p.secondaryLabel} href={p.secondaryLink?.href} variant="outline" size="lg" /> : null}
          </div>
        ) : null}
        {p.image?.src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.image.src} alt={p.image.alt} className="mt-6 h-auto w-full rounded-xl border object-cover shadow-xs" />
        ) : null}
      </div>
    </section>
  ),
});

export const FeatureList = defineBlock({
  name: 'FeatureList',
  label: L('Feature list', 'Danh sách tính năng', 'Liste de fonctionnalités', 'Daftar fitur'),
  category: 'marketing',
  fields: {
    heading: text(L('Heading', 'Tiêu đề', 'Titre', 'Judul'), 'Features'),
    columns: b.select({ label: L('Columns', 'Số cột', 'Colonnes', 'Jumlah kolom'), options: [2, 3, 4], default: 3 }),
    items: b.list(
      {
        title: text(L('Title', 'Tiêu đề', 'Titre', 'Judul'), 'Feature'),
        description: b.longText({ label: L('Description', 'Mô tả', 'Description', 'Deskripsi'), default: 'Describe this feature.' }),
      },
      {
        label: L('Features', 'Tính năng', 'Fonctionnalités', 'Fitur'),
        default: [
          { title: 'Fast', description: 'Built for speed from the first request.' },
          { title: 'Flexible', description: 'Adapts to the way your team works.' },
          { title: 'Secure', description: 'Sensible defaults you can trust.' },
        ],
      },
    ),
  },
  render: ({ heading, columns, items }) => (
    <section className={cn(PY['12'], 'bg-background text-foreground')}>
      <div className="mx-auto w-full max-w-5xl space-y-8 px-4 sm:px-6">
        {heading ? <h2 className="text-3xl font-semibold tracking-tight">{heading}</h2> : null}
        <div className={cn('grid gap-6', GRID_COLS[columns])}>
          {items.map((it, i) => (
            <CardBox key={i} className="px-6">
              <h3 className="leading-none font-semibold">{it.title}</h3>
              {it.description ? <p className="text-sm text-muted-foreground">{it.description}</p> : null}
            </CardBox>
          ))}
        </div>
      </div>
    </section>
  ),
});

export const CallToAction = defineBlock({
  name: 'CallToAction',
  label: L('Call to action', 'Lời kêu gọi hành động', "Appel à l'action", 'Ajakan bertindak'),
  category: 'marketing',
  fields: {
    heading: text(L('Heading', 'Tiêu đề', 'Titre', 'Judul'), 'Ready to get started?'),
    description: b.longText({ label: L('Description', 'Mô tả', 'Description', 'Deskripsi'), default: 'Join us today.' }),
    buttonLabel: text(L('Button label', 'Nhãn nút', 'Libellé du bouton', 'Label tombol'), 'Contact us'),
    link: b.link({ label: L('Link', 'Liên kết', 'Lien', 'Tautan') }),
    background: b.color({ label: L('Background', 'Nền', 'Arrière-plan', 'Latar belakang'), default: 'primary' }),
  },
  render: ({ heading, description, buttonLabel, link, background }) => (
    <section className={cn(BG[background], 'py-12')}>
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-4 px-4 text-center sm:px-6">
        <h2 className="text-3xl font-semibold tracking-tight">{heading}</h2>
        {description ? <p className="max-w-2xl opacity-90">{description}</p> : null}
        {buttonLabel ? <LinkButton label={buttonLabel} href={link?.href} variant={background === 'primary' ? 'secondary' : 'default'} size="lg" /> : null}
      </div>
    </section>
  ),
});

export const FAQ = defineBlock({
  name: 'FAQ',
  label: L('FAQ', 'Câu hỏi thường gặp', 'FAQ', 'FAQ'),
  category: 'marketing',
  fields: {
    heading: text(L('Heading', 'Tiêu đề', 'Titre', 'Judul'), 'Frequently asked questions'),
    items: b.list(
      {
        question: text(L('Question', 'Câu hỏi', 'Question', 'Pertanyaan'), 'Question'),
        answer: b.longText({ label: L('Answer', 'Trả lời', 'Réponse', 'Jawaban'), default: 'Answer' }),
      },
      {
        label: L('Questions', 'Câu hỏi', 'Questions', 'Pertanyaan'),
        default: [{ question: 'What is this?', answer: 'A short answer.' }],
      },
    ),
  },
  // Native <details>/<summary> keeps the accordion interactive with no client JavaScript, so this block
  // needs no 'use client' boundary and stays server-renderable.
  render: ({ heading, items }) => (
    <section className="bg-background py-12 text-foreground">
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 sm:px-6">
        {heading ? <h2 className="text-3xl font-semibold tracking-tight">{heading}</h2> : null}
        <div className="divide-y rounded-xl border">
          {items.map((it, i) => (
            <details key={i} className="group px-4 py-3">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {it.question}
                <span aria-hidden="true" className="text-muted-foreground transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="pt-2 text-sm text-muted-foreground">{it.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  ),
});
