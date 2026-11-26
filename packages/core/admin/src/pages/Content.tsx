import { Redirect, useAdminParams, useAdminSearchParam } from '../lib/nav';
import { ContentList } from './content/ContentList';

/**
 * `/content/:apiId`: the entries list (spec §8). Keyed by `apiId` so moving between content types starts from clean
 * state. An old `?entry=<documentId>` deep link goes to that entry's detail page.
 */
export function Content() {
  const { apiId = '' } = useAdminParams();
  const entry = useAdminSearchParam('entry');
  const locale = useAdminSearchParam('locale');
  if (entry) {
    const q = locale ? `?locale=${encodeURIComponent(locale)}` : '';
    return <Redirect to={`/content/${apiId}/${encodeURIComponent(entry)}${q}`} />;
  }
  return <ContentList key={apiId} apiId={apiId} />;
}
