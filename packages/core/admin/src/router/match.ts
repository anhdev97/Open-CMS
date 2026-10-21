export type RouteId = 'uikit' | 'setup' | 'login' | 'home' | 'content' | 'settingsUsers' | 'settingsContentTypes' | 'settingsLanguages' | 'redirectUsers' | 'redirectBuilder' | 'account' | 'notFound';

export interface RouteMatch {
  id: RouteId;
  params: Record<string, string>;
  guarded: boolean;
}

const SIMPLE: Record<string, RouteId> = { builder: 'redirectBuilder', users: 'redirectUsers', account: 'account' };

const SETTINGS: Record<string, RouteId> = {
  users: 'settingsUsers',
  'content-types': 'settingsContentTypes',
  languages: 'settingsLanguages',
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
  if (s.length === 2 && first === 'settings') {
    const id = Object.hasOwn(SETTINGS, second) ? SETTINGS[second] : undefined;
    if (id) return { id, params: {}, guarded: true };
  }
  return { id: 'notFound', params: {}, guarded: true };
}
