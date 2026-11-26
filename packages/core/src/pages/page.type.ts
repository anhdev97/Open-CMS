import { defineContentType, f, PAGE_API_ID, type ContentTypeDefinition } from '@opencloudcms/schema';

/**
 * Core-owned page content type. Not in the project's schema files or `_snapshot.json`: its tables come from the
 * core migrations `0006_pages` and `0007_page_kind`, which must match what the codegen DDL would produce for this definition
 * (guarded by the drift test in test/integration/pages-type.test.ts), except that `kind` and `isDefault` are also
 * `not null` with a default there (field definitions cannot say so).
 *
 * `path` is required at publish for `kind: 'page'` only (page hooks); base pages have none. `isDefault` is managed
 * by `PUT /api/admin/pages/bases/default` alone; `kind` is set on create and never changes.
 */
export const pageType: ContentTypeDefinition = defineContentType({
  id: 'ct_opencloudcms_page',
  apiId: PAGE_API_ID,
  displayName: 'Page',
  fields: {
    title: f.text({ id: 'fld_page_title', required: true, localizable: true }),
    path: f.text({ id: 'fld_page_path', localizable: true, unique: true }),
    seo: f.json({ id: 'fld_page_seo', localizable: true }),
    content: f.json({ id: 'fld_page_content', localizable: true }),
    kind: f.text({ id: 'fld_page_kind', maxLength: 16 }),
    isDefault: f.boolean({ id: 'fld_page_is_default' }),
    layout: f.json({ id: 'fld_page_layout' }),
  },
});
