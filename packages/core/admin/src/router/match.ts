export type RouteId = 'uikit' | 'setup' | 'login' | 'home' | 'assets' | 'content' | 'contentNew' | 'contentDetail' | 'contentEdit' | 'pages' | 'pageEditor' | 'settingsUsers' | 'settingsGroups' | 'settingsContentTypes' | 'settingsContentTypeNew' | 'settingsContentTypeDetail' | 'settingsContentTypeEdit' | 'settingsContentGroups' | 'settingsLanguages' | 'settingsBlocks' | 'settingsTheme' | 'blockEditor' | 'redirectUsers' | 'redirectBuilder' | 'account' | 'notFound';

export interface RouteMatch {
  id: RouteId;
  params: Record<string, string>;
  guarded: boolean;
  /** Rendered without the admin sidebar and top bar (the page and block editors). */
  fullScreen?: boolean;
}

const SIMPLE: Record<string, RouteId> = { builder: 'redirectBuilder', users: 'redirectUsers', account: 'account', assets: 'assets', pages: 'pages' };

const SETTINGS: Record<string, RouteId> = {
  users: 'settingsUsers',
  groups: 'settingsGroups',
  'content-types': 'settingsContentTypes',
  languages: 'settingsLanguages',
  blocks: 'settingsBlocks',
  theme: 'settingsTheme',
};

/** Pure matcher for the `[[...slug]]` catch-all (spec §5.2). `setup`, `login` and `_ui` sit outside AuthGate. */
export function matchRoute(slug: string[] | undefined, opts: { dev?: boolean } = {}): RouteMatch {
  const dev = opts.dev ?? process.env.NODE_ENV !== 'production';
  const s = slug ?? [];
  if (s.length === 0) return { id: 'home', params: {}, guarded: true };
  const [first, second] = s;
  if (s.length === 1) {
    if (first === '_ui' && dev) return { id: 'uikit', params: {}, guarded: false };
    if (first === 'setup') return { id: 'setup', params: {}, guarded: false };
    if (first === 'login') return { id: 'login', params: {}, guarded: false };
    const id = Object.hasOwn(SIMPLE, first) ? SIMPLE[first] : undefined;
    if (id) return { id, params: {}, guarded: true };
  }
  if (s.length === 2 && first === 'content' && second) {
    return { id: 'content', params: { apiId: second }, guarded: true };
  }
  if (s.length === 3 && first === 'content' && second && s[2]) {
    if (s[2] === 'new') return { id: 'contentNew', params: { apiId: second }, guarded: true };
    return { id: 'contentDetail', params: { apiId: second, documentId: s[2] }, guarded: true };
  }
  if (s.length === 4 && first === 'content' && second && s[2] && s[3] === 'edit') {
    return { id: 'contentEdit', params: { apiId: second, documentId: s[2] }, guarded: true };
  }
  if (s.length === 2 && first === 'pages' && second) {
    return { id: 'pageEditor', params: { documentId: second }, guarded: true, fullScreen: true };
  }
  if (s.length === 2 && first === 'settings') {
    const id = Object.hasOwn(SETTINGS, second) ? SETTINGS[second] : undefined;
    if (id) return { id, params: {}, guarded: true };
  }
  if (s.length === 3 && first === 'settings' && second === 'content-types' && s[2]) {
    if (s[2] === 'new') return { id: 'settingsContentTypeNew', params: {}, guarded: true };
    if (s[2] === 'groups') return { id: 'settingsContentGroups', params: {}, guarded: true };
    return { id: 'settingsContentTypeDetail', params: { apiId: s[2] }, guarded: true };
  }
  if (s.length === 4 && first === 'settings' && second === 'content-types' && s[2] && s[3] === 'edit') {
    return { id: 'settingsContentTypeEdit', params: { apiId: s[2] }, guarded: true };
  }
  if (s.length === 3 && first === 'settings' && second === 'blocks' && s[2]) {
    return { id: 'blockEditor', params: { name: s[2] }, guarded: true, fullScreen: true };
  }
  return { id: 'notFound', params: {}, guarded: true };
}
