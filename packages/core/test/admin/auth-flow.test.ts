import { describe, expect, it } from 'vitest';
import { ApiError } from '../../admin/src/lib/api-error';
import { errorMessage, loginPageAction, loginUrl, setupFieldErrors, validateSetup } from '../../admin/src/lib/auth-flow';
import { en } from '../../admin/src/i18n/en';

describe('loginUrl', () => {
  it('keeps the /admin path and search as returnTo', () => {
    expect(loginUrl({ pathname: '/admin/builder', search: '?type=product' })).toBe(
      '/api/auth/login?returnTo=%2Fadmin%2Fbuilder%3Ftype%3Dproduct',
    );
  });
  it('handles the root', () => {
    expect(loginUrl({ pathname: '/admin/', search: '' })).toBe('/api/auth/login?returnTo=%2Fadmin%2F');
  });
});

describe('loginPageAction', () => {
  it('restarts without a uid', () => {
    expect(loginPageAction('')).toEqual({ kind: 'restart' });
    expect(loginPageAction('?error=login_failed')).toEqual({ kind: 'restart' });
  });
  it('shows with a uid', () => {
    expect(loginPageAction('?uid=abc')).toEqual({ kind: 'show', uid: 'abc' });
  });
  it('carries the error code', () => {
    expect(loginPageAction('?uid=abc&error=login_expired')).toEqual({ kind: 'show', uid: 'abc', error: 'login_expired' });
  });
});

describe('errorMessage', () => {
  it('maps known codes', () => {
    expect(errorMessage('login_expired')).toBe(en.login.errors.login_expired);
    expect(errorMessage('account_disabled')).toBe(en.login.errors.account_disabled);
  });
  it('uses the generic message for unknown or missing codes', () => {
    expect(errorMessage('weird')).toBe(en.login.errors.generic);
    expect(errorMessage(null)).toBe(en.login.errors.generic);
    expect(errorMessage('weird')).not.toBe(errorMessage('login_expired'));
  });
});

describe('validateSetup', () => {
  const ok = { email: 'a@b.co', name: 'Ann', password: 'correct horse battery', confirm: 'correct horse battery' };
  it('accepts valid input', () => expect(validateSetup(ok)).toEqual({}));
  it('rejects an 11-char password and accepts 12', () => {
    expect(validateSetup({ ...ok, password: 'a'.repeat(11), confirm: 'a'.repeat(11) })).toHaveProperty('password');
    expect(validateSetup({ ...ok, password: 'a'.repeat(12), confirm: 'a'.repeat(12) })).toEqual({});
  });
  it('rejects a 257-char password and accepts 256', () => {
    expect(validateSetup({ ...ok, password: 'a'.repeat(257), confirm: 'a'.repeat(257) })).toHaveProperty('password');
    expect(validateSetup({ ...ok, password: 'a'.repeat(256), confirm: 'a'.repeat(256) })).toEqual({});
  });
  it('rejects a password equal to the email, ignoring case and spaces', () => {
    const email = 'someone@example.com';
    const pw = '  SOMEONE@Example.com ';
    expect(validateSetup({ ...ok, email: ` ${email}`, password: pw, confirm: pw })).toHaveProperty('password');
  });
  it('rejects a mismatched confirmation', () => {
    expect(validateSetup({ ...ok, confirm: 'different password!' })).toEqual({ confirm: en.setup.errors.confirmMismatch });
  });
  it('requires email and name', () => {
    expect(Object.keys(validateSetup({ ...ok, email: ' ', name: '' })).sort()).toEqual(['email', 'name']);
  });
});

describe('setupFieldErrors', () => {
  it('puts weak_password on the password field', () => {
    expect(setupFieldErrors(new ApiError(422, 'weak_password', 'too short'))).toEqual({ password: 'too short' });
  });
  it('splits validation_failed by field path', () => {
    const e = new ApiError(422, 'validation_failed', 'email: Invalid email; body: Required');
    expect(setupFieldErrors(e)).toEqual({ email: 'Invalid email', form: 'body: Required' });
  });
  it('falls back to a form error', () => {
    expect(setupFieldErrors(new ApiError(500, 'error', 'boom'))).toEqual({ form: 'boom' });
  });
});
