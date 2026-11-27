// Composed block. Managed by OpenCloudCMS: edit by hand or from the admin
// Block Builder (which rewrites this file).
import { defineComposedBlock } from '@opencloudcms/core/blocks';

export default defineComposedBlock({
  id: 'blk_questions01',
  name: 'Questions',
  label: { 'en-US': 'Questions', 'vi-VN': 'Câu hỏi' },
  category: 'marketing',
  icon: 'messages-square',
  version: 1,
  fields: {
    heading: {
      kind: 'text',
      label: { 'en-US': 'Heading', 'vi-VN': 'Tiêu đề' },
      default: 'Questions from our customers',
    },
    intro: {
      kind: 'longText',
      label: { 'en-US': 'Introduction', 'vi-VN': 'Giới thiệu' },
      default: 'The questions we hear most often. Something else? Write to us.',
    },
    allLabel: {
      kind: 'text',
      label: { 'en-US': 'Button label', 'vi-VN': 'Nhãn nút' },
      default: 'See all questions',
    },
    allLink: {
      kind: 'link',
      label: { 'en-US': 'Button link', 'vi-VN': 'Liên kết nút' },
      default: { kind: 'url', href: '/about' },
    },
  },
  tree: {
    el: 'Stack',
    props: { direction: 'vertical', gap: '6' },
    children: [
      { el: 'Heading', props: { level: 2 }, bind: { text: { from: 'field', name: 'heading' } } },
      { el: 'Text', bind: { text: { from: 'field', name: 'intro' } } },
      {
        el: 'CollectionList',
        props: {
          key: 'questions',
          apiId: 'question',
          sort: { field: 'order', direction: 'asc' },
          limit: 6,
          layout: { kind: 'list' },
          emptyText: { 'en-US': 'No questions yet.', 'vi-VN': 'Chưa có câu hỏi nào.' },
          editor: { limit: true },
        },
        children: [
          {
            el: 'Card',
            children: [
              {
                el: 'Accordion',
                props: { single: true, defaultOpen: 'none' },
                children: [
                  {
                    el: 'AccordionItem',
                    bind: { title: { from: 'entry', path: 'question' } },
                    children: [
                      { el: 'Text', bind: { text: { from: 'entry', path: 'answer' } } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        el: 'Button',
        props: { variant: 'outline' },
        bind: { label: { from: 'field', name: 'allLabel' }, href: { from: 'field', name: 'allLink' } },
      },
    ],
    style: {
      padding: {
        base: { t: '30px', r: '5%', b: '30px', l: '5%' },
        md: { t: '72px', r: '5%', b: '72px', l: '5%' },
      },
    },
  },
});
