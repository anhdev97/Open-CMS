// Render-baseline fixture: this my-store block exactly as it was at 37be4d7 (before the builder components), so the
// renderer keeps drawing pre-sprint header/overlay specs byte-identically. Only this header and the import path differ.
import { defineComposedBlock } from '../../../../blocks/src';

export default defineComposedBlock({
  id: 'blk_contactmodal01',
  name: 'ContactModal',
  label: { 'en-US': 'Contact popup', 'vi-VN': 'Hộp thoại liên hệ' },
  category: 'overlay',
  icon: 'message-circle',
  version: 1,
  fields: {
    heading: { kind: 'text', label: { 'en-US': 'Heading', 'vi-VN': 'Tiêu đề' }, default: 'Contact us' },
    body: {
      kind: 'longText',
      label: { 'en-US': 'Text', 'vi-VN': 'Nội dung' },
      default: 'Questions about an order, a size or a return? Write or call us, we answer within a day.',
    },
    email: {
      kind: 'text',
      label: { 'en-US': 'Email', 'vi-VN': 'Email' },
      default: 'hello@example.com',
    },
    emailLink: {
      kind: 'link',
      label: { 'en-US': 'Email link', 'vi-VN': 'Liên kết email' },
      default: { kind: 'url', href: 'mailto:hello@example.com' },
    },
    phone: {
      kind: 'text',
      label: { 'en-US': 'Phone', 'vi-VN': 'Điện thoại' },
      default: '+84 28 1234 5678',
    },
    phoneLink: {
      kind: 'link',
      label: { 'en-US': 'Phone link', 'vi-VN': 'Liên kết điện thoại' },
      default: { kind: 'url', href: 'tel:+842812345678' },
    },
    closeLabel: {
      kind: 'text',
      label: { 'en-US': 'Close button', 'vi-VN': 'Nút đóng' },
      default: 'Close',
    },
  },
  tree: {
    el: 'Overlay',
    props: { variant: 'modal', size: 'md', labelledBy: 'first-heading' },
    children: [
      {
        el: 'Stack',
        props: { direction: 'vertical', gap: '4', align: 'start' },
        children: [
          { el: 'Heading', props: { level: 2 }, bind: { text: { from: 'field', name: 'heading' } } },
          { el: 'Text', bind: { text: { from: 'field', name: 'body' } } },
          {
            el: 'Stack',
            props: { direction: 'vertical', gap: '1', align: 'start' },
            children: [
              {
                el: 'Button',
                props: { variant: 'link', size: 'sm' },
                bind: { label: { from: 'field', name: 'email' }, href: { from: 'field', name: 'emailLink' } },
                style: { padding: { l: '0', r: '0' }, color: 'brand:accent' },
              },
              {
                el: 'Button',
                props: { variant: 'link', size: 'sm' },
                bind: { label: { from: 'field', name: 'phone' }, href: { from: 'field', name: 'phoneLink' } },
                style: { padding: { l: '0', r: '0' }, color: 'brand:accent' },
              },
            ],
          },
          {
            el: 'Button',
            props: { variant: 'outline', action: { type: 'overlay', op: 'close' } },
            bind: { label: { from: 'field', name: 'closeLabel' } },
          },
        ],
      },
    ],
    style: {
      padding: { t: '8', r: '8', b: '8', l: '8' },
      background: 'brand:surface',
      color: 'brand:ink',
      radius: 'lg',
    },
  },
});
