// Leaves the website preview: /__opencloudcms/preview/exit (turns draft mode off, back to the published page).
import { createPreviewExitRoute } from '@opencloudcms/core/blocks/next';

export const dynamic = 'force-dynamic';
export const { GET } = createPreviewExitRoute();
