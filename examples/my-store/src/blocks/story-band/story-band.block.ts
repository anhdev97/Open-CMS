// Composed block. Managed by OpenCloudCMS: edit by hand or from the admin
// Block Builder (which rewrites this file).
import { defineComposedBlock } from '@opencloudcms/core/blocks';

export default defineComposedBlock({
  id: 'blk_storyband01',
  name: 'StoryBand',
  label: { 'en-US': 'Story band', 'vi-VN': 'Dải câu chuyện' },
  category: 'marketing',
  icon: 'book-open',
  version: 1,
  fields: {
    heading: {
      kind: 'text',
      label: { 'en-US': 'Heading', 'vi-VN': 'Tiêu đề' },
      default: 'About my-store',
    },
    body: {
      kind: 'longText',
      label: { 'en-US': 'Text', 'vi-VN': 'Nội dung' },
      default: 'We choose easy-care materials and easy-to-pair shapes, so every piece you buy has a place in your wardrobe.',
    },
    linkLabel: {
      kind: 'text',
      label: { 'en-US': 'Link label', 'vi-VN': 'Nhãn liên kết' },
      default: 'Read the story of the store →',
    },
    link: {
      kind: 'link',
      label: { 'en-US': 'Link', 'vi-VN': 'Liên kết' },
      default: { kind: 'url', href: '/about' },
    },
  },
  tree: {
    el: 'Box',
    children: [
      {
        el: 'Columns',
        props: {
          count: 2,
          tracks: { base: ['1fr'], md: ['2fr', '3fr'] },
          alignY: 'start',
          gapX: '50px',
          gapY: '24px',
        },
        children: [
          { el: 'Heading', props: { level: 2 }, bind: { text: { from: 'field', name: 'heading' } } },
          {
            el: 'Stack',
            props: { direction: 'vertical', gap: '4', align: 'start' },
            children: [
              { el: 'Text', bind: { text: { from: 'field', name: 'body' } } },
              {
                el: 'Button',
                props: { variant: 'link', size: 'sm' },
                bind: { label: { from: 'field', name: 'linkLabel' }, href: { from: 'field', name: 'link' } },
                style: { padding: { l: '0', r: '0' }, color: 'brand:ink' },
              },
            ],
          },
        ],
      },
    ],
    style: {
      padding: {
        base: { t: '30px', r: '5%', b: '30px', l: '5%' },
        md: { t: '72px', r: '5%', b: '72px', l: '5%' },
      },
      background: 'brand:feature',
    },
  },
});
