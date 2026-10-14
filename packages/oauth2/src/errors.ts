import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';

export type AuthErrorCode =
  | 'unauthenticated' | 'setup_required' | 'setup_already_completed' | 'invalid_credentials'
  | 'account_disabled' | 'forbidden' | 'origin_mismatch' | 'validation_failed' | 'weak_password'
  | 'email_taken' | 'last_super_admin' | 'rate_limited'
  | 'idp_account_not_found' | 'idp_email_unverified' | 'login_expired' | 'invalid_state';

export class AuthError extends Error {
  retryAfterSec?: number;
  constructor(
    public readonly code: AuthErrorCode,
    public readonly status: number,
    message?: string,
    opts?: { retryAfterSec?: number },
  ) {
    super(message ?? code);
    this.name = 'AuthError';
    this.retryAfterSec = opts?.retryAfterSec;
  }
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

@Catch(AuthError)
export class AuthExceptionFilter implements ExceptionFilter<AuthError> {
  catch(err: AuthError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse();
    if (err.retryAfterSec !== undefined) res.setHeader('Retry-After', String(err.retryAfterSec));
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
}
