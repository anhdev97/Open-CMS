// Composed block. Managed by OpenCloudCMS: edit by hand or from the admin
// Block Builder (which rewrites this file).
import { defineComposedBlock } from '@opencloudcms/core/blocks';

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
    nameLabel: {
      kind: 'text',
      label: { 'en-US': 'Form: name label', 'vi-VN': 'Biểu mẫu: nhãn họ tên' },
      default: 'Name',
    },
    emailLabel: {
      kind: 'text',
      label: { 'en-US': 'Form: email label', 'vi-VN': 'Biểu mẫu: nhãn email' },
      default: 'Email',
    },
    phoneLabel: {
      kind: 'text',
      label: { 'en-US': 'Form: phone label', 'vi-VN': 'Biểu mẫu: nhãn điện thoại' },
      default: 'Phone',
    },
    topicLabel: {
      kind: 'text',
      label: { 'en-US': 'Form: topic label', 'vi-VN': 'Biểu mẫu: nhãn chủ đề' },
      default: 'Topic',
    },
    topicPlaceholder: {
      kind: 'text',
      label: { 'en-US': 'Form: topic placeholder', 'vi-VN': 'Biểu mẫu: gợi ý chủ đề' },
      default: 'Choose a topic',
    },
    messageLabel: {
      kind: 'text',
      label: { 'en-US': 'Form: message label', 'vi-VN': 'Biểu mẫu: nhãn lời nhắn' },
      default: 'Message',
    },
    messagePlaceholder: {
      kind: 'text',
      label: { 'en-US': 'Form: message placeholder', 'vi-VN': 'Biểu mẫu: gợi ý lời nhắn' },
      default: 'How can we help?',
    },
    newsletterLabel: {
      kind: 'text',
      label: { 'en-US': 'Form: newsletter label', 'vi-VN': 'Biểu mẫu: nhãn bản tin' },
      default: 'Send me the newsletter',
    },
    sendLabel: {
      kind: 'text',
      label: { 'en-US': 'Form: send button', 'vi-VN': 'Biểu mẫu: nút gửi' },
      default: 'Send',
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
        props: { direction: 'vertical', gap: '4', align: 'stretch' },
        children: [
          { el: 'Heading', props: { level: 2 }, bind: { text: { from: 'field', name: 'heading' } } },
          { el: 'Text', bind: { text: { from: 'field', name: 'body' } } },
          {
            el: 'Columns',
            props: { count: 2, gap: '4', tracks: { base: ['1fr'], md: ['1fr', '1fr'] } },
            children: [
              {
                el: 'Input',
                props: { name: 'name', type: 'text', required: true, autocomplete: 'name' },
                bind: { label: { from: 'field', name: 'nameLabel' } },
              },
              {
                el: 'Input',
                props: { name: 'email', type: 'email', required: true, autocomplete: 'email' },
                bind: { label: { from: 'field', name: 'emailLabel' } },
              },
              {
                el: 'Input',
                props: { name: 'phone', type: 'tel', autocomplete: 'tel' },
                bind: { label: { from: 'field', name: 'phoneLabel' } },
              },
              {
                el: 'Select',
                props: {
                  name: 'topic',
                  options: [
                    { value: 'order', label: { 'en-US': 'An order', 'vi-VN': 'Đơn hàng' } },
                    { value: 'size', label: { 'en-US': 'Sizes and fit', 'vi-VN': 'Kích cỡ' } },
                    { value: 'return', label: { 'en-US': 'Returns', 'vi-VN': 'Đổi trả' } },
                    { value: 'other', label: { 'en-US': 'Something else', 'vi-VN': 'Vấn đề khác' } },
                  ],
                },
                bind: {
                  label: { from: 'field', name: 'topicLabel' },
                  placeholder: { from: 'field', name: 'topicPlaceholder' },
                },
              },
            ],
          },
          {
            el: 'Textarea',
            props: { name: 'message', rows: 4, required: true },
            bind: {
              label: { from: 'field', name: 'messageLabel' },
              placeholder: { from: 'field', name: 'messagePlaceholder' },
            },
          },
          {
            el: 'Checkbox',
            props: { name: 'newsletter', value: 'yes' },
            bind: { label: { from: 'field', name: 'newsletterLabel' } },
          },
          {
            el: 'Stack',
            props: { direction: 'horizontal', gap: '3', align: 'center', wrap: true },
            children: [
              {
                el: 'Button',
                props: { variant: 'default', icon: 'send', iconPosition: 'end' },
                bind: { label: { from: 'field', name: 'sendLabel' } },
                style: {
                  background: 'brand:accent',
                  color: 'brand:accent-ink',
                  hover: { background: 'brand:ink' },
                },
              },
              {
                el: 'Button',
                props: { variant: 'outline', action: { type: 'overlay', op: 'close' } },
                bind: { label: { from: 'field', name: 'closeLabel' } },
              },
            ],
          },
          {
            el: 'Stack',
            props: { direction: 'vertical', gap: '1', align: 'start' },
            children: [
              {
                el: 'Button',
                props: { variant: 'link', size: 'sm', icon: 'mail' },
                bind: { label: { from: 'field', name: 'email' }, href: { from: 'field', name: 'emailLink' } },
                style: { padding: { l: '0', r: '0' }, color: 'brand:accent' },
              },
              {
                el: 'Button',
                props: { variant: 'link', size: 'sm', icon: 'phone' },
                bind: { label: { from: 'field', name: 'phone' }, href: { from: 'field', name: 'phoneLink' } },
                style: { padding: { l: '0', r: '0' }, color: 'brand:accent' },
              },
            ],
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
