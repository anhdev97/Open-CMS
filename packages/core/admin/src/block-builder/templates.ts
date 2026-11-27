// Starter templates of the block builder palette (spec §3 "Starter templates", Decisions 4 and 6): prebuilt subtrees
// of existing elements, inserted with constant text in the admin's current locale and edited freely afterwards.
// Inserting a template adds no block fields. Relative imports only (root vitest).
import type { ComposedElement, ComposedNode, NodeStyle } from '@opencloudcms/schema';
import { puckPropsOf, type BuilderPuckData, type PuckItem } from './tree-puck';

export type TemplateId = 'nav-menu' | 'mobile-nav' | 'faq' | 'product-tabs' | 'banner-carousel' | 'contact-form' | 'list-with-heading';

export interface BuilderTemplate {
  id: TemplateId;
  /** Translation key of the palette label. */
  label: string;
  /** The subtree, its text in `locale` (English for a locale without copy). */
  tree(locale: string): ComposedNode;
}

/** Puck component names of the templates: `Template-<id>` (no `:`, Puck splits zone ids on it). */
export const TEMPLATE_PREFIX = 'Template-';
export const templateName = (id: TemplateId) => `${TEMPLATE_PREFIX}${id}`;

interface Copy {
  nav: { home: string; shop: string; shopItems: [string, string, string]; about: string; contact: string };
  faq: { heading: string; items: [string, string][] };
  tabs: { description: [string, string]; specs: [string, string]; shipping: [string, string] };
  banner: { heading: string; button: string; alt: string }[];
  form: {
    name: string; email: string; phone: string; topic: string; topicPlaceholder: string;
    topics: { general: string; order: string; other: string }; message: string; messagePlaceholder: string; newsletter: string; send: string;
  };
  list: { heading: string; intro: string; item: string; itemText: string; all: string };
}

/** Placeholder copy of the templates in the 4 admin locales. */
const COPY: Record<'en-US' | 'vi-VN' | 'fr-FR' | 'id-ID', Copy> = {
  'en-US': {
    nav: { home: 'Home', shop: 'Shop', shopItems: ['New arrivals', 'Best sellers', 'Sale'], about: 'About', contact: 'Contact' },
    faq: {
      heading: 'Frequently asked questions',
      items: [
        ['How long does delivery take?', 'Orders usually arrive within 3 to 5 working days.'],
        ['Can I return a product?', 'Yes, you can return any item within 30 days of delivery.'],
        ['How can I contact you?', 'Write to us through the contact form and we will reply within a day.'],
      ],
    },
    tabs: {
      description: ['Description', 'Describe the product here: what it is, what it is made of and who it is for.'],
      specs: ['Specs', 'List the dimensions, weight, materials and other details.'],
      shipping: ['Shipping', 'Explain delivery times, costs and the return policy.'],
    },
    banner: [
      { heading: 'New season collection', button: 'Shop now', alt: 'New season collection' },
      { heading: 'Free delivery on every order', button: 'Learn more', alt: 'Free delivery' },
      { heading: 'Up to 50% off', button: 'See the sale', alt: 'Sale' },
    ],
    form: {
      name: 'Name', email: 'Email', phone: 'Phone', topic: 'Topic', topicPlaceholder: 'Choose a topic',
      topics: { general: 'General question', order: 'My order', other: 'Something else' },
      message: 'Message', messagePlaceholder: 'How can we help?', newsletter: 'Send me the newsletter', send: 'Send',
    },
    list: { heading: 'Latest from us', intro: 'A short introduction to the list below.', item: 'Item title', itemText: 'Item summary', all: 'See all' },
  },
  'vi-VN': {
    nav: { home: 'Trang chủ', shop: 'Cửa hàng', shopItems: ['Hàng mới về', 'Bán chạy', 'Khuyến mãi'], about: 'Giới thiệu', contact: 'Liên hệ' },
    faq: {
      heading: 'Câu hỏi thường gặp',
      items: [
        ['Bao lâu thì nhận được hàng?', 'Đơn hàng thường đến trong 3 đến 5 ngày làm việc.'],
        ['Tôi có thể trả hàng không?', 'Có, bạn có thể trả hàng trong vòng 30 ngày kể từ khi nhận.'],
        ['Liên hệ với cửa hàng thế nào?', 'Hãy gửi tin nhắn qua biểu mẫu liên hệ, chúng tôi sẽ trả lời trong một ngày.'],
      ],
    },
    tabs: {
      description: ['Mô tả', 'Mô tả sản phẩm tại đây: sản phẩm là gì, làm từ gì và dành cho ai.'],
      specs: ['Thông số', 'Liệt kê kích thước, trọng lượng, chất liệu và các chi tiết khác.'],
      shipping: ['Giao hàng', 'Giải thích thời gian giao hàng, chi phí và chính sách đổi trả.'],
    },
    banner: [
      { heading: 'Bộ sưu tập mùa mới', button: 'Mua ngay', alt: 'Bộ sưu tập mùa mới' },
      { heading: 'Miễn phí giao hàng mọi đơn', button: 'Tìm hiểu thêm', alt: 'Miễn phí giao hàng' },
      { heading: 'Giảm đến 50%', button: 'Xem khuyến mãi', alt: 'Khuyến mãi' },
    ],
    form: {
      name: 'Họ tên', email: 'Email', phone: 'Số điện thoại', topic: 'Chủ đề', topicPlaceholder: 'Chọn chủ đề',
      topics: { general: 'Câu hỏi chung', order: 'Đơn hàng của tôi', other: 'Vấn đề khác' },
      message: 'Lời nhắn', messagePlaceholder: 'Chúng tôi có thể giúp gì?', newsletter: 'Gửi bản tin cho tôi', send: 'Gửi',
    },
    list: { heading: 'Mới nhất', intro: 'Đoạn giới thiệu ngắn cho danh sách bên dưới.', item: 'Tiêu đề mục', itemText: 'Tóm tắt mục', all: 'Xem tất cả' },
  },
  'fr-FR': {
    nav: { home: 'Accueil', shop: 'Boutique', shopItems: ['Nouveautés', 'Meilleures ventes', 'Soldes'], about: 'À propos', contact: 'Contact' },
    faq: {
      heading: 'Questions fréquentes',
      items: [
        ['Quel est le délai de livraison ?', 'Les commandes arrivent en général sous 3 à 5 jours ouvrés.'],
        ['Puis-je retourner un produit ?', 'Oui, vous pouvez retourner un article dans les 30 jours suivant la livraison.'],
        ['Comment vous contacter ?', 'Écrivez-nous via le formulaire de contact, nous répondons sous un jour.'],
      ],
    },
    tabs: {
      description: ['Description', 'Décrivez le produit ici : ce qu’il est, sa composition et à qui il s’adresse.'],
      specs: ['Caractéristiques', 'Indiquez les dimensions, le poids, les matières et les autres détails.'],
      shipping: ['Livraison', 'Expliquez les délais, les frais de livraison et la politique de retour.'],
    },
    banner: [
      { heading: 'Nouvelle collection', button: 'Acheter', alt: 'Nouvelle collection' },
      { heading: 'Livraison offerte sur toute commande', button: 'En savoir plus', alt: 'Livraison offerte' },
      { heading: 'Jusqu’à -50 %', button: 'Voir les soldes', alt: 'Soldes' },
    ],
    form: {
      name: 'Nom', email: 'E-mail', phone: 'Téléphone', topic: 'Sujet', topicPlaceholder: 'Choisissez un sujet',
      topics: { general: 'Question générale', order: 'Ma commande', other: 'Autre chose' },
      message: 'Message', messagePlaceholder: 'Comment pouvons-nous vous aider ?', newsletter: 'Recevoir la newsletter', send: 'Envoyer',
    },
    list: { heading: 'Nos dernières nouveautés', intro: 'Une courte introduction à la liste ci-dessous.', item: 'Titre de l’élément', itemText: 'Résumé de l’élément', all: 'Tout voir' },
  },
  'id-ID': {
    nav: { home: 'Beranda', shop: 'Toko', shopItems: ['Produk baru', 'Terlaris', 'Diskon'], about: 'Tentang kami', contact: 'Kontak' },
    faq: {
      heading: 'Pertanyaan umum',
      items: [
        ['Berapa lama pengiriman?', 'Pesanan biasanya tiba dalam 3 sampai 5 hari kerja.'],
        ['Bisakah saya mengembalikan produk?', 'Ya, Anda dapat mengembalikan barang dalam 30 hari setelah diterima.'],
        ['Bagaimana cara menghubungi Anda?', 'Kirim pesan lewat formulir kontak, kami membalas dalam satu hari.'],
      ],
    },
    tabs: {
      description: ['Deskripsi', 'Jelaskan produk di sini: apa itu, bahannya, dan untuk siapa.'],
      specs: ['Spesifikasi', 'Cantumkan ukuran, berat, bahan, dan detail lainnya.'],
      shipping: ['Pengiriman', 'Jelaskan waktu dan biaya pengiriman serta kebijakan pengembalian.'],
    },
    banner: [
      { heading: 'Koleksi musim baru', button: 'Belanja sekarang', alt: 'Koleksi musim baru' },
      { heading: 'Gratis ongkir untuk semua pesanan', button: 'Selengkapnya', alt: 'Gratis ongkir' },
      { heading: 'Diskon hingga 50%', button: 'Lihat diskon', alt: 'Diskon' },
    ],
    form: {
      name: 'Nama', email: 'Email', phone: 'Telepon', topic: 'Topik', topicPlaceholder: 'Pilih topik',
      topics: { general: 'Pertanyaan umum', order: 'Pesanan saya', other: 'Lainnya' },
      message: 'Pesan', messagePlaceholder: 'Apa yang bisa kami bantu?', newsletter: 'Kirimi saya buletin', send: 'Kirim',
    },
    list: { heading: 'Terbaru dari kami', intro: 'Pengantar singkat untuk daftar di bawah ini.', item: 'Judul item', itemText: 'Ringkasan item', all: 'Lihat semua' },
  },
};

const copyOf = (locale: string): Copy => COPY[locale as keyof typeof COPY] ?? COPY['en-US'];
const text = (value: string) => ({ from: 'const' as const, value });
const node = (el: ComposedElement, rest: Omit<ComposedNode, 'el'> = {}): ComposedNode => ({ el, ...rest });

/** Nav link colours on hover (theme tokens). */
const LINK_HOVER: NodeStyle = { hover: { color: 'primary' } };
const link = (label: string, href: string) =>
  node('Button', { props: { variant: 'link' }, bind: { label: text(label), href: text(href) }, style: structuredClone(LINK_HOVER) });

function nav(c: Copy, mobile: boolean): ComposedNode {
  const [a, b, d] = c.nav.shopItems;
  const shop = node('Dropdown', {
    props: mobile
      ? { openOn: 'click', placement: 'bottom-start', display: { base: 'inline' }, triggerVariant: 'ghost', chevron: true }
      : { openOn: 'hover', placement: 'bottom-start', display: { base: 'popover' }, triggerVariant: 'ghost', chevron: true },
    bind: { label: text(c.nav.shop) },
    children: [
      node('Stack', {
        props: { direction: 'vertical', gap: '2' },
        children: [link(a, '/shop/new'), link(b, '/shop/best-sellers'), link(d, '/shop/sale')],
      }),
    ],
  });
  return node('Stack', {
    props: mobile ? { direction: 'vertical', gap: '2', align: 'start' } : { direction: 'horizontal', gap: '4', align: 'center', wrap: true },
    children: [link(c.nav.home, '/'), shop, link(c.nav.about, '/about'), link(c.nav.contact, '/contact')],
  });
}

const paragraph = (s: string) => node('Text', { bind: { text: text(s) } });

export const BUILDER_TEMPLATES: readonly BuilderTemplate[] = [
  { id: 'nav-menu', label: 'blockBuilder.templates.navMenu', tree: (l) => nav(copyOf(l), false) },
  { id: 'mobile-nav', label: 'blockBuilder.templates.mobileNav', tree: (l) => nav(copyOf(l), true) },
  {
    id: 'faq',
    label: 'blockBuilder.templates.faq',
    tree: (l) => {
      const c = copyOf(l).faq;
      return node('Stack', {
        props: { direction: 'vertical', gap: '4' },
        children: [
          node('Heading', { props: { level: 2 }, bind: { text: text(c.heading) } }),
          node('Accordion', {
            props: { single: false, defaultOpen: 'none' },
            children: c.items.map(([q, a]) => node('AccordionItem', { bind: { title: text(q) }, children: [paragraph(a)] })),
          }),
        ],
      });
    },
  },
  {
    id: 'product-tabs',
    label: 'blockBuilder.templates.productTabs',
    tree: (l) => {
      const c = copyOf(l).tabs;
      return node('Tabs', {
        props: { variant: 'underline', align: 'start' },
        children: [c.description, c.specs, c.shipping].map(([label, body]) => node('TabPanel', { bind: { label: text(label) }, children: [paragraph(body)] })),
      });
    },
  },
  {
    id: 'banner-carousel',
    label: 'blockBuilder.templates.bannerCarousel',
    tree: (l) =>
      node('Carousel', {
        props: { perView: { base: 1 }, gap: '4', arrows: true, dots: true, loop: true, autoplay: 5 },
        children: copyOf(l).banner.map((s) =>
          node('Stack', {
            props: { direction: 'vertical', gap: '4', align: 'start' },
            children: [
              node('Image', { props: { ratio: 'wide', rounded: true, fit: 'cover' }, bind: { alt: text(s.alt) } }),
              node('Heading', { props: { level: 2 }, bind: { text: text(s.heading) } }),
              node('Button', { props: { variant: 'default' }, bind: { label: text(s.button), href: text('/shop') } }),
            ],
          }),
        ),
      }),
  },
  {
    id: 'contact-form',
    label: 'blockBuilder.templates.contactForm',
    tree: (l) => {
      const c = copyOf(l).form;
      return node('Stack', {
        props: { direction: 'vertical', gap: '4' },
        children: [
          node('Input', { props: { name: 'name', type: 'text', required: true, autocomplete: 'name' }, bind: { label: text(c.name) } }),
          node('Input', { props: { name: 'email', type: 'email', required: true, autocomplete: 'email' }, bind: { label: text(c.email) } }),
          node('Input', { props: { name: 'phone', type: 'tel', autocomplete: 'tel' }, bind: { label: text(c.phone) } }),
          node('Select', {
            props: {
              name: 'topic',
              options: [
                { value: 'general', label: c.topics.general },
                { value: 'order', label: c.topics.order },
                { value: 'other', label: c.topics.other },
              ],
            },
            bind: { label: text(c.topic), placeholder: text(c.topicPlaceholder) },
          }),
          node('Textarea', { props: { name: 'message', rows: 4, required: true }, bind: { label: text(c.message), placeholder: text(c.messagePlaceholder) } }),
          node('Checkbox', { props: { name: 'newsletter', value: 'on' }, bind: { label: text(c.newsletter) } }),
          // No action: form submission is a later phase.
          node('Button', { props: { variant: 'default' }, bind: { label: text(c.send) } }),
        ],
      });
    },
  },
  {
    // A common heading and button around a Collection list (spec §1): the title renders once, the Card per entry. The
    // list's content type is filled when it is inserted (`fillListDefaults`).
    id: 'list-with-heading',
    label: 'blockBuilder.templates.listWithHeading',
    tree: (l) => {
      const c = copyOf(l).list;
      return node('Stack', {
        props: { direction: 'vertical', gap: '6' },
        children: [
          node('Heading', { props: { level: 2 }, bind: { text: text(c.heading) } }),
          paragraph(c.intro),
          node('CollectionList', {
            props: { key: 'list', apiId: '', limit: 6, layout: { kind: 'grid', columns: 3 } },
            children: [
              node('Card', {
                children: [node('Heading', { props: { level: 3 }, bind: { text: text(c.item) } }), paragraph(c.itemText)],
              }),
            ],
          }),
          node('Button', { props: { variant: 'outline' }, bind: { label: text(c.all), href: text('/') } }),
        ],
      });
    },
  },
];

const BY_NAME = new Map(BUILDER_TEMPLATES.map((t) => [templateName(t.id), t]));
/** The element of each template's root (the same in every locale). */
const ROOT_EL = new Map(BUILDER_TEMPLATES.map((t) => [templateName(t.id), t.tree('en-US').el]));

export const templateOf = (name: string): BuilderTemplate | undefined => BY_NAME.get(name);
export const templateRootEl = (name: string): ComposedElement | undefined => ROOT_EL.get(name);

/** Puck props of a node without ids (Puck's `populateIds` gives every inserted item a fresh one). */
export function templatePuckProps(n: ComposedNode): Record<string, unknown> {
  const props: Record<string, unknown> = puckPropsOf(n.el, structuredClone(n.props ?? {}));
  if (n.bind) props.bind = structuredClone(n.bind);
  if (n.showIf) props.showIf = structuredClone(n.showIf);
  if (n.style && Object.keys(n.style).length) props.style = structuredClone(n.style);
  if (n.children) props.children = n.children.map((c) => ({ type: c.el, props: templatePuckProps(c) }));
  return props;
}

const elementsOf = (n: ComposedNode, out = new Set<string>()) => {
  out.add(n.el);
  for (const c of n.children ?? []) elementsOf(c, out);
  return out;
};

/**
 * Template component names a slot refuses: those whose root element is in `direct` (rules on the slot's direct
 * children) or that contain an element of `deep` at any depth (rules on all descendants).
 */
export function templatesRefused(direct: readonly string[], deep: readonly string[]): string[] {
  return BUILDER_TEMPLATES.filter((t) => {
    const tree = t.tree('en-US');
    if (direct.includes(tree.el)) return true;
    const els = elementsOf(tree);
    return deep.some((e) => els.has(e));
  }).map((t) => templateName(t.id));
}

/**
 * The Puck data with every inserted template item turned into its root element (same props, ids and position), or
 * null when there is none.
 */
export function expandTemplates(data: BuilderPuckData): BuilderPuckData | null {
  // Returns the same array when nothing inside it changed.
  const fix = (items: unknown): unknown => {
    if (!Array.isArray(items)) return items;
    let any = false;
    const out = (items as PuckItem[]).map((it) => {
      if (!it || typeof it !== 'object' || !it.props) return it;
      const el = ROOT_EL.get(it.type);
      const kids = it.props.children;
      const nextKids = fix(kids);
      if (!el && nextKids === kids) return it;
      any = true;
      return { ...it, type: el ?? it.type, props: nextKids === kids ? it.props : { ...it.props, children: nextKids } };
    });
    return any ? out : items;
  };
  const content = fix(data.content) as PuckItem[];
  return content === data.content ? null : { ...data, content };
}
