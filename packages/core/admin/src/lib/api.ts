import { ApiError } from './api-error';
import { loginUrl } from './auth-flow';

export interface ApiInit extends RequestInit {
  /** Sent as the JSON body. */
  json?: unknown;
  /** When false, a 401 is only thrown (AuthGate and the login screens handle it themselves). Default true. */
  redirectOn401?: boolean;
}

export interface ApiDeps {
  fetch?: typeof fetch;
  location?: Pick<Location, 'assign' | 'pathname' | 'search'>;
}

interface ErrorBody {
  error?: { code?: string; message?: string; issues?: unknown[] };
}

/**
 * Calls the same-origin `/api/**` (or `/oauth2/interaction/**`) with the session cookie. Failures throw
 * `ApiError` built from `{ error: { code, message, issues } }`; a `401 unauthenticated` also sends the whole
 * page to `/api/auth/login?returnTo=…` unless `redirectOn401: false`.
 */
export async function api<T>(path: string, init: ApiInit = {}, deps: ApiDeps = {}): Promise<T> {
  const doFetch = deps.fetch ?? globalThis.fetch.bind(globalThis);
  const { json, redirectOn401, headers, ...rest } = init;
  const finalHeaders = new Headers(headers);
  let body = rest.body;
  if (json !== undefined) {
    body = JSON.stringify(json);
    finalHeaders.set('Content-Type', 'application/json');
  }
  const res = await doFetch(path, { ...rest, body, headers: finalHeaders, credentials: 'same-origin' });

  if (res.ok) {
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  const payload = (await res.json().catch(() => ({}))) as ErrorBody;
  const retryAfter = Number(res.headers.get('Retry-After'));
  const error = new ApiError(
    res.status,
    payload.error?.code ?? 'error',
    payload.error?.message ?? res.statusText,
    payload.error?.issues ?? [],
    res.headers.get('Retry-After') !== null && Number.isFinite(retryAfter) ? retryAfter : undefined,
  );
  if (res.status === 401 && error.code === 'unauthenticated' && redirectOn401 !== false) {
    const location = deps.location ?? globalThis.location;
    location.assign(loginUrl(location));
  }
  throw error;
}
