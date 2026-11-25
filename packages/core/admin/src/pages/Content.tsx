import { Redirect, useAdminParams, useAdminSearchParam } from '../lib/nav';
import { ContentList } from './content/ContentList';

/**
 * `/content/:apiId`: the entries list (spec §8). Keyed by `apiId` so moving between content types starts from clean
 * state. An old `?entry=<documentId>` deep link goes to that entry's detail page.
 */
export function Content() {
  const { apiId = '' } = useAdminParams();
  const entry = useAdminSearchParam('entry');
  if (entry) return <Redirect to={`/content/${apiId}/${encodeURIComponent(entry)}`} />;
  return <ContentList key={apiId} apiId={apiId} />;
}
