// Composed block. Managed by OpenCloudCMS: edit by hand or from the admin
// Block Builder (which rewrites this file).
import { defineComposedBlock } from '@opencloudcms/core/blocks';

export default defineComposedBlock({
  id: 'blk_homebanner01',
  name: 'HomeBanner',
  label: { 'en-US': 'Home banner carousel', 'vi-VN': 'Băng chuyền banner trang chủ' },
  category: 'marketing',
  icon: 'gallery-horizontal',
  version: 1,
  fields: {
    slide1Heading: {
      kind: 'text',
      label: { 'en-US': 'Slide 1: heading', 'vi-VN': 'Trang 1: tiêu đề' },
      default: 'New season linen',
    },
    slide1Text: {
      kind: 'longText',
      label: { 'en-US': 'Slide 1: text', 'vi-VN': 'Trang 1: nội dung' },
      default: 'Light shirts in washed linen, cut for warm days.',
    },
    slide1CtaLabel: {
      kind: 'text',
      label: { 'en-US': 'Slide 1: button label', 'vi-VN': 'Trang 1: nhãn nút' },
      default: 'Shop tops',
    },
    slide1CtaLink: {
      kind: 'link',
      label: { 'en-US': 'Slide 1: button link', 'vi-VN': 'Trang 1: liên kết nút' },
      default: { kind: 'url', href: '/shop/ao' },
    },
    slide1Image: {
      kind: 'image',
      label: { 'en-US': 'Slide 1: image', 'vi-VN': 'Trang 1: hình ảnh' },
      default: { src: '/files/store-banner-1.webp', alt: 'Olive linen shirt on a hanger' },
    },
    slide2Heading: {
      kind: 'text',
      label: { 'en-US': 'Slide 2: heading', 'vi-VN': 'Trang 2: tiêu đề' },
      default: 'Totes for every day',
    },
    slide2Text: {
      kind: 'longText',
      label: { 'en-US': 'Slide 2: text', 'vi-VN': 'Trang 2: nội dung' },
      default: 'Sturdy canvas bags that carry a laptop and the market shopping.',
    },
    slide2CtaLabel: {
      kind: 'text',
      label: { 'en-US': 'Slide 2: button label', 'vi-VN': 'Trang 2: nhãn nút' },
      default: 'Shop accessories',
    },
    slide2CtaLink: {
      kind: 'link',
      label: { 'en-US': 'Slide 2: button link', 'vi-VN': 'Trang 2: liên kết nút' },
      default: { kind: 'url', href: '/shop/phu-kien' },
    },
    slide2Image: {
      kind: 'image',
      label: { 'en-US': 'Slide 2: image', 'vi-VN': 'Trang 2: hình ảnh' },
      default: { src: '/files/store-banner-2.webp', alt: 'Natural canvas tote bag on a wooden bench' },
    },
    slide3Heading: {
      kind: 'text',
      label: { 'en-US': 'Slide 3: heading', 'vi-VN': 'Trang 3: tiêu đề' },
      default: 'Free delivery from 500,000 ₫',
    },
    slide3Text: {
      kind: 'longText',
      label: { 'en-US': 'Slide 3: text', 'vi-VN': 'Trang 3: nội dung' },
      default: 'Orders over 500,000 ₫ ship free anywhere in Vietnam.',
    },
    slide3CtaLabel: {
      kind: 'text',
      label: { 'en-US': 'Slide 3: button label', 'vi-VN': 'Trang 3: nhãn nút' },
      default: 'See the collection',
    },
    slide3CtaLink: {
      kind: 'link',
      label: { 'en-US': 'Slide 3: button link', 'vi-VN': 'Trang 3: liên kết nút' },
      default: { kind: 'url', href: '/shop' },
    },
    slide3Image: {
      kind: 'image',
      label: { 'en-US': 'Slide 3: image', 'vi-VN': 'Trang 3: hình ảnh' },
      default: { src: '/files/store-banner-3.webp', alt: 'Brick-red scarf folded on a wooden bench' },
    },
  },
  tree: {
    el: 'Box',
    children: [
      {
        el: 'Carousel',
        props: { perView: { base: 1 }, gap: '4', arrows: true, dots: true, loop: true, autoplay: 5 },
        children: [
          {
            el: 'Columns',
            props: { count: 2, gap: '0', alignY: 'center', tracks: { base: ['1fr'], md: ['1fr', '1fr'] } },
            children: [
              {
                el: 'Stack',
                props: { direction: 'vertical', gap: '4', align: 'start', justify: 'center' },
                children: [
                  {
                    el: 'Heading',
                    props: { level: 2 },
                    bind: { text: { from: 'field', name: 'slide1Heading' } },
                  },
                  { el: 'Text', bind: { text: { from: 'field', name: 'slide1Text' } } },
                  {
                    el: 'Button',
                    props: { icon: 'arrow-right', iconPosition: 'end' },
                    bind: {
                      label: { from: 'field', name: 'slide1CtaLabel' },
                      href: { from: 'field', name: 'slide1CtaLink' },
                    },
                    style: {
                      background: 'brand:accent',
                      color: 'brand:accent-ink',
                      radius: 'none',
                      hover: { background: 'brand:ink' },
                    },
                  },
                ],
                style: {
                  padding: {
                    base: { t: '24px', r: '24px', b: '24px', l: '24px' },
                    md: { t: '48px', r: '48px', b: '48px', l: '48px' },
                  },
                },
              },
              {
                el: 'Image',
                props: { fit: 'cover', aspect: '3/2' },
                bind: { src: { from: 'field', name: 'slide1Image' } },
              },
            ],
            style: { background: 'brand:feature' },
          },
          {
            el: 'Columns',
            props: { count: 2, gap: '0', alignY: 'center', tracks: { base: ['1fr'], md: ['1fr', '1fr'] } },
            children: [
              {
                el: 'Stack',
                props: { direction: 'vertical', gap: '4', align: 'start', justify: 'center' },
                children: [
                  {
                    el: 'Heading',
                    props: { level: 2 },
                    bind: { text: { from: 'field', name: 'slide2Heading' } },
                  },
                  { el: 'Text', bind: { text: { from: 'field', name: 'slide2Text' } } },
                  {
                    el: 'Button',
                    props: { icon: 'arrow-right', iconPosition: 'end' },
                    bind: {
                      label: { from: 'field', name: 'slide2CtaLabel' },
                      href: { from: 'field', name: 'slide2CtaLink' },
                    },
                    style: {
                      background: 'brand:accent',
                      color: 'brand:accent-ink',
                      radius: 'none',
                      hover: { background: 'brand:ink' },
                    },
                  },
                ],
                style: {
                  padding: {
                    base: { t: '24px', r: '24px', b: '24px', l: '24px' },
                    md: { t: '48px', r: '48px', b: '48px', l: '48px' },
                  },
                },
              },
              {
                el: 'Image',
                props: { fit: 'cover', aspect: '3/2' },
                bind: { src: { from: 'field', name: 'slide2Image' } },
              },
            ],
            style: { background: 'brand:feature' },
          },
          {
            el: 'Columns',
            props: { count: 2, gap: '0', alignY: 'center', tracks: { base: ['1fr'], md: ['1fr', '1fr'] } },
            children: [
              {
                el: 'Stack',
                props: { direction: 'vertical', gap: '4', align: 'start', justify: 'center' },
                children: [
                  {
                    el: 'Heading',
                    props: { level: 2 },
                    bind: { text: { from: 'field', name: 'slide3Heading' } },
                  },
                  { el: 'Text', bind: { text: { from: 'field', name: 'slide3Text' } } },
                  {
                    el: 'Button',
                    props: { icon: 'arrow-right', iconPosition: 'end' },
                    bind: {
                      label: { from: 'field', name: 'slide3CtaLabel' },
                      href: { from: 'field', name: 'slide3CtaLink' },
                    },
                    style: {
                      background: 'brand:accent',
                      color: 'brand:accent-ink',
                      radius: 'none',
                      hover: { background: 'brand:ink' },
                    },
                  },
                ],
                style: {
                  padding: {
                    base: { t: '24px', r: '24px', b: '24px', l: '24px' },
                    md: { t: '48px', r: '48px', b: '48px', l: '48px' },
                  },
                },
              },
              {
                el: 'Image',
                props: { fit: 'cover', aspect: '3/2' },
                bind: { src: { from: 'field', name: 'slide3Image' } },
              },
            ],
            style: { background: 'brand:feature' },
          },
        ],
      },
    ],
    style: { padding: { t: '40px', r: '5%', b: '40px', l: '5%' }, background: 'brand:surface' },
  },
});
