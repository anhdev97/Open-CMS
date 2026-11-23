import { useAdminParams } from '../lib/nav';

/** Placeholder; Task 7 replaces this body with the Puck editor. */
export function PageEditor() {
  const { documentId = '' } = useAdminParams();
  return <div data-page-editor={documentId} className="p-4" />;
}
