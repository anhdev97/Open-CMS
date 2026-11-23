// Website preview (draft mode) for signed-in admins: /__opencloudcms/preview?page=<documentId>&locale=<locale>.
// The folder is named %5F_opencloudcms because Next treats folders starting with "_" as private.
import { createPreviewRoute } from '@opencloudcms/core/blocks/next';

export const dynamic = 'force-dynamic';
export const { GET } = createPreviewRoute();
