// Composed block. Managed by OpenCloudCMS: edit by hand or from the admin
// Block Builder (which rewrites this file).
import { defineComposedBlock } from '@opencloudcms/core/blocks';

export default defineComposedBlock({
  id: 'blk_sectionhead01',
  name: 'SectionHead',
  label: { 'en-US': 'Section heading', 'vi-VN': 'Tiêu đề mục' },
  category: 'marketing',
  icon: 'heading',
  version: 1,
  fields: {
    heading: {
      kind: 'text',
      label: { 'en-US': 'Heading', 'vi-VN': 'Tiêu đề' },
      default: 'Featured products',
    },
    linkLabel: {
      kind: 'text',
      label: { 'en-US': 'Link label', 'vi-VN': 'Nhãn liên kết' },
      default: 'View all →',
    },
    link: {
      kind: 'link',
      label: { 'en-US': 'Link', 'vi-VN': 'Liên kết' },
      default: { kind: 'url', href: '/shop' },
    },
  },
  tree: {
    el: 'Stack',
    props: { direction: 'horizontal', gap: '4', align: 'end', justify: 'between', wrap: true },
    children: [
      { el: 'Heading', props: { level: 2 }, bind: { text: { from: 'field', name: 'heading' } } },
      {
        el: 'Button',
        props: { variant: 'link', size: 'sm' },
        bind: { label: { from: 'field', name: 'linkLabel' }, href: { from: 'field', name: 'link' } },
        style: { padding: { l: '0', r: '0' }, color: 'brand:ink' },
      },
    ],
    style: {
      padding: { base: { t: '30px', r: '16px', l: '16px' }, md: { t: '72px', r: '24px', l: '24px' } },
      margin: { r: 'auto', l: 'auto' },
      maxWidth: '64rem',
    },
  },
});
