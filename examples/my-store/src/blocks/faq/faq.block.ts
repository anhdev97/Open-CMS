// Composed block. Managed by OpenCloudCMS: edit by hand or from the admin
// Block Builder (which rewrites this file).
import { defineComposedBlock } from '@opencloudcms/core/blocks';

export default defineComposedBlock({
  id: 'blk_faqblock01',
  name: 'Faq',
  label: { 'en-US': 'FAQ', 'vi-VN': 'Câu hỏi thường gặp' },
  category: 'marketing',
  icon: 'circle-help',
  version: 1,
  fields: {
    heading: {
      kind: 'text',
      label: { 'en-US': 'Heading', 'vi-VN': 'Tiêu đề' },
      default: 'Frequently asked questions',
    },
    q1: {
      kind: 'text',
      label: { 'en-US': 'Question 1', 'vi-VN': 'Câu hỏi 1' },
      default: 'How long does delivery take?',
    },
    a1: {
      kind: 'longText',
      label: { 'en-US': 'Answer 1', 'vi-VN': 'Trả lời 1' },
      default: 'Orders in Ho Chi Minh City and Hanoi arrive in 1 to 2 days, elsewhere in Vietnam in 3 to 5 working days.',
    },
    q2: {
      kind: 'text',
      label: { 'en-US': 'Question 2', 'vi-VN': 'Câu hỏi 2' },
      default: 'Can I return or exchange an item?',
    },
    a2: {
      kind: 'longText',
      label: { 'en-US': 'Answer 2', 'vi-VN': 'Trả lời 2' },
      default: 'Yes. Unworn items with their tags can be returned or exchanged within 30 days of delivery.',
    },
    q3: {
      kind: 'text',
      label: { 'en-US': 'Question 3', 'vi-VN': 'Câu hỏi 3' },
      default: 'How do I choose my size?',
    },
    a3: {
      kind: 'longText',
      label: { 'en-US': 'Answer 3', 'vi-VN': 'Trả lời 3' },
      default: 'Each product page lists the measurements under Specs. Between two sizes, take the larger one for linen.',
    },
    q4: {
      kind: 'text',
      label: { 'en-US': 'Question 4', 'vi-VN': 'Câu hỏi 4' },
      default: 'How do I care for linen?',
    },
    a4: {
      kind: 'longText',
      label: { 'en-US': 'Answer 4', 'vi-VN': 'Trả lời 4' },
      default: 'Wash at 30 °C, dry in the shade and iron while still slightly damp.',
    },
  },
  tree: {
    el: 'Stack',
    props: { direction: 'vertical', gap: '4' },
    children: [
      { el: 'Heading', props: { level: 2 }, bind: { text: { from: 'field', name: 'heading' } } },
      {
        el: 'Accordion',
        props: { single: true, defaultOpen: 'first' },
        children: [
          {
            el: 'AccordionItem',
            bind: { title: { from: 'field', name: 'q1' } },
            children: [
              { el: 'Text', bind: { text: { from: 'field', name: 'a1' } } },
            ],
          },
          {
            el: 'AccordionItem',
            bind: { title: { from: 'field', name: 'q2' } },
            children: [
              { el: 'Text', bind: { text: { from: 'field', name: 'a2' } } },
            ],
          },
          {
            el: 'AccordionItem',
            bind: { title: { from: 'field', name: 'q3' } },
            children: [
              { el: 'Text', bind: { text: { from: 'field', name: 'a3' } } },
            ],
          },
          {
            el: 'AccordionItem',
            bind: { title: { from: 'field', name: 'q4' } },
            children: [
              { el: 'Text', bind: { text: { from: 'field', name: 'a4' } } },
            ],
          },
        ],
      },
    ],
    style: {
      padding: { t: '60px', r: '5%', b: '60px', l: '5%' },
      background: 'brand:surface',
      color: 'brand:ink',
    },
  },
});
