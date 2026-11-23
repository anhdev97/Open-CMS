import { defineContentType, f, PAGE_API_ID, type ContentTypeDefinition } from '@opencloudcms/schema';

/**
 * Core-owned page content type. Not in the project's schema files or `_snapshot.json`: its tables come from the
 * core migration `0006_pages`, which must match what the codegen DDL would produce for this definition
 * (guarded by the drift test in test/integration/pages-type.test.ts).
 */
export const pageType: ContentTypeDefinition = defineContentType({
  id: 'ct_opencloudcms_page',
  apiId: PAGE_API_ID,
  displayName: 'Page',
  fields: {
    title: f.text({ id: 'fld_page_title', required: true, localizable: true }),
    path: f.text({ id: 'fld_page_path', required: true, localizable: true, unique: true }),
    seo: f.json({ id: 'fld_page_seo', localizable: true }),
    content: f.json({ id: 'fld_page_content', localizable: true }),
  },
});
