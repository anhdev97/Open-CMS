// Source of truth for this content type. Edit by hand or from the admin
// Content Type Builder (which rewrites this file), then run `opencloudcms migrate:create`.
import { defineContentType, f } from '@opencloudcms/schema';

export default defineContentType({
  id: 'ct_cyl4n4',
  apiId: 'blogcategories',
  displayName: { 'en-US': 'Categories', 'vi-VN': 'Danh mục' },
  group: 'blog',
  fields: {
    title: f.text({ id: 'fld_g8tii7', label: 'Tên', localizable: true }),
  },
});
