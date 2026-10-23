import { ApiError } from './api-error';
import { t } from '../i18n';

const ADMIN_PREFIX = '/admin';

/** `/api/auth/login?returnTo=…` for the browser location (`/admin/...`), so the user lands back where they were. */
export function loginUrl(loc: { pathname: string; search: string }): string {
  const inner = loc.pathname.startsWith(ADMIN_PREFIX) ? loc.pathname.slice(ADMIN_PREFIX.length) : loc.pathname;
  return '/api/auth/login?returnTo=' + encodeURIComponent(ADMIN_PREFIX + inner + loc.search);
}

export type LoginPageAction =
  | { kind: 'restart' }
  | { kind: 'error'; error: string }
  | { kind: 'show'; uid: string; error?: string };

/**
 * `/login` with a `uid` shows the form. Redirect-chain failures arrive as `?error=<code>` without a uid and are
 * only shown (with "Try again"). With neither, the whole page restarts at `/api/auth/login`.
 */
export function loginPageAction(search: string): LoginPageAction {
  const params = new URLSearchParams(search);
  const uid = params.get('uid');
  const error = params.get('error');
  if (!uid) return error ? { kind: 'error', error } : { kind: 'restart' };
  return error ? { kind: 'show', uid, error } : { kind: 'show', uid };
}

const KNOWN_LOGIN_ERRORS = [
  'login_expired',
  'login_failed',
  'invalid_state',
  'idp_account_not_found',
  'idp_email_unverified',
  'account_disabled',
] as const;

/** Maps an `?error=` code to its active-locale message; unknown or missing codes get the generic one. */
export function errorMessage(code: string | null): string {
  if (code && (KNOWN_LOGIN_ERRORS as readonly string[]).includes(code)) return t(`login.errors.${code}`);
  return t('login.errors.generic');
}

export interface SetupValues {
  email: string;
  name: string;
  password: string;
  confirm: string;
}

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 256;

/** Client-side setup checks (mirrors the server rules). Returns `{ field: message }`, empty when valid. */
export function validateSetup(v: SetupValues): Record<string, string> {
  const errors: Record<string, string> = {};
  const email = v.email.trim();
  if (!email) errors.email = t('setup.errors.emailRequired');
  if (!v.name.trim()) errors.name = t('setup.errors.nameRequired');
  if (v.password.length < PASSWORD_MIN) errors.password = t('setup.errors.passwordShort', { min: PASSWORD_MIN });
  else if (v.password.length > PASSWORD_MAX) errors.password = t('setup.errors.passwordLong', { max: PASSWORD_MAX });
  else if (email && v.password.trim().toLowerCase() === email.toLowerCase()) errors.password = t('setup.errors.passwordIsEmail');
  if (v.confirm !== v.password) errors.confirm = t('setup.errors.confirmMismatch');
  return errors;
}

const SETUP_FIELDS = ['email', 'name', 'password'] as const;
export type SetupField = (typeof SETUP_FIELDS)[number];

/**
 * Maps a 422 from `POST /api/auth/setup` to a form field: `weak_password` is about the password; a
 * `validation_failed` message is `path: message; …`, so each segment naming a known field goes to it.
 * Anything left over has no field and is returned under `form`.
 */
export function setupFieldErrors(err: ApiError): Partial<Record<SetupField | 'form', string>> {
  if (err.code === 'weak_password') return { password: err.message };
  const out: Partial<Record<SetupField | 'form', string>> = {};
  if (err.code === 'validation_failed') {
    for (const segment of err.message.split('; ')) {
      const m = /^(\w+): (.+)$/.exec(segment);
      const field = m && (SETUP_FIELDS as readonly string[]).includes(m[1]) ? (m[1] as SetupField) : undefined;
      if (m && field) out[field] ??= m[2];
      else out.form ??= segment;
    }
    return out;
  }
  return { form: err.message };
}

/** The text for a 403 `origin_mismatch` (the page was opened at an address other than the public URL), else null. */
export function originMismatchMessage(e: unknown): string | null {
  return e instanceof ApiError && e.status === 403 && e.code === 'origin_mismatch' ? t('auth.originMismatch') : null;
}
