// Compile-time guard for defineMessages (checked by `tsc --noEmit`; not exported from index).
import { defineMessages } from '../i18n';

export const ok = defineMessages({
  'en-US': { hello: 'Hello {name}', nested: { a: 'A' } },
  'vi-VN': { hello: 'Xin chào {name}', nested: { a: 'Một' } },
  'fr-FR': { hello: 'Bonjour {name}' },
});

export const extraKey = defineMessages({
  'en-US': { hello: 'Hello' },
  // @ts-expect-error key missing from en-US
  'vi-VN': { hello: 'Xin chào', bogus: 'x' },
});
