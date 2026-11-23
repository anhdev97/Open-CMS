// Every website path that no other route of app/(site) handles: the page published at that path in the admin
// (Pages), rendered with the blocks of src/blocks. Draft mode (website preview) shows drafts to signed-in admins.
// Until a page is published at /, the home shows a welcome page. A path without a page is a 404 (not-found.tsx).
import { createCmsPage } from '@opencloudcms/core/blocks/next';
import blocks from '../../../src/blocks';

const cms = createCmsPage({ blocks, siteName: 'my-store' });

// Next only reads segment config written literally in this file.
export const dynamic = 'force-dynamic';
export default cms.Page;
export const generateMetadata = cms.generateMetadata;
