// Source of truth for this content type. Edit by hand or from the admin
// Content Type Builder (which rewrites this file), then run `opencloudcms migrate:create`.
import { defineContentType, f } from '@opencloudcms/schema';

export default defineContentType({
  id: 'ct_question01',
  apiId: 'question',
  displayName: { 'en-US': 'Question', 'vi-VN': 'Câu hỏi' },
  group: 'shop',
  // Shown by the Questions block (src/blocks/questions): a CollectionList sorted by `order`.
  fields: {
    question: f.text({ id: 'fld_quest_question', required: true, localizable: true }),
    answer: f.longText({ id: 'fld_quest_answer', required: true, localizable: true }),
    order: f.number({ id: 'fld_quest_order', indexed: true }),
  },
});
