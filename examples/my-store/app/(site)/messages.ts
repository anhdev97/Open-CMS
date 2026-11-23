// Strings of the website. Server components import the helpers from '@opencloudcms/core';
// client components ('use client') must import them from '@opencloudcms/core/admin' instead.
import { defineMessages } from '@opencloudcms/core';

export const messages = defineMessages({
  // Add strings per language, e.g. 'en-US': { footer: { contact: 'Contact us' } }, 'vi-VN': { footer: { contact: 'Liên hệ' } },
  // and read them with createTranslator(messages, locale)('footer.contact').
  'en-US': {},
  'vi-VN': {},
});
