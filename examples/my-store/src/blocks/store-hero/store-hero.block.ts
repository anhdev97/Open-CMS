// Composed block. Managed by OpenCloudCMS: edit by hand or from the admin
// Block Builder (which rewrites this file).
import { defineComposedBlock } from '@opencloudcms/core/blocks';

export default defineComposedBlock({
  id: 'blk_storehero01',
  name: 'StoreHero',
  label: { 'en-US': 'Store hero', 'vi-VN': 'Ảnh bìa cửa hàng' },
  category: 'marketing',
  icon: 'image',
  version: 1,
  fields: {
    heading: {
      kind: 'text',
      label: { 'en-US': 'Heading', 'vi-VN': 'Tiêu đề' },
      default: 'Wear well every day',
    },
    intro: {
      kind: 'longText',
      label: { 'en-US': 'Intro', 'vi-VN': 'Giới thiệu' },
      default: 'Breathable linen shirts, sturdy canvas totes and simple pieces made to last.',
    },
    ctaLabel: {
      kind: 'text',
      label: { 'en-US': 'Button label', 'vi-VN': 'Nhãn nút' },
      default: 'View the collection →',
    },
    ctaLink: {
      kind: 'link',
      label: { 'en-US': 'Button link', 'vi-VN': 'Liên kết nút' },
      default: { kind: 'url', href: '/shop' },
    },
    image: {
      kind: 'image',
      label: { 'en-US': 'Image', 'vi-VN': 'Hình ảnh' },
      default: {
        src: '/files/store-editorial.webp',
        alt: 'Olive linen shirt, canvas tote and clay scarf on a wooden bench',
      },
    },
  },
  tree: {
    el: 'Columns',
    props: { count: 2, gap: '0', tracks: { base: ['1fr'], md: ['2fr', '3fr'] } },
    children: [
      {
        el: 'Stack',
        props: { direction: 'vertical', gap: '6', align: 'start', justify: 'center' },
        children: [
          { el: 'Heading', props: { level: 1 }, bind: { text: { from: 'field', name: 'heading' } } },
          { el: 'Text', props: { size: 'lg' }, bind: { text: { from: 'field', name: 'intro' } } },
          {
            el: 'Button',
            props: { size: 'lg' },
            bind: { label: { from: 'field', name: 'ctaLabel' }, href: { from: 'field', name: 'ctaLink' } },
            style: { background: 'brand:accent', color: 'brand:accent-ink', radius: 'none' },
          },
        ],
        style: {
          padding: {
            base: { t: '30px', r: '30px', b: '30px', l: '30px' },
            md: { t: '75px', r: '75px', b: '75px', l: '75px' },
          },
        },
      },
      {
        el: 'Image',
        props: { fit: 'cover', aspect: { base: '3/2', md: 'auto' } },
        bind: { src: { from: 'field', name: 'image' } },
        style: { height: { md: '100%' }, minHeight: { base: '0', md: '450px' } },
      },
    ],
    style: { background: 'brand:feature' },
  },
});
