import { STATUS_CODES } from 'node:http';
import { BadRequestException, Catch, HttpException, Inject, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';

export type AuthErrorCode =
  | 'unauthenticated' | 'setup_required' | 'setup_already_completed' | 'invalid_credentials'
  | 'account_disabled' | 'forbidden' | 'origin_mismatch' | 'validation_failed' | 'weak_password'
  | 'not_found' | 'email_taken' | 'last_super_admin' | 'rate_limited'
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

function sendError(host: ArgumentsHost, status: number, code: string, message: string, issues?: unknown[]): void {
  host.switchToHttp().getResponse().status(status).json({ error: issues === undefined ? { code, message } : { code, message, issues } });
}

function renderAuthError(err: AuthError, host: ArgumentsHost): void {
  if (err.retryAfterSec !== undefined) host.switchToHttp().getResponse().setHeader('Retry-After', String(err.retryAfterSec));
  sendError(host, err.status, err.code, err.message);
}

@Catch(AuthError)
export class AuthExceptionFilter implements ExceptionFilter<AuthError> {
  catch(err: AuthError, host: ArgumentsHost): void {
    renderAuthError(err, host);
  }
}

/**
 * Nest turns body-parser's SyntaxError (malformed JSON) into a plain BadRequestException before any
 * route matched (its error handler does the same for a URIError of a malformed path), so no `req.route`.
 */
const isMalformedRequest = (e: unknown, req: { route?: unknown }): boolean =>
  e instanceof BadRequestException && req.route === undefined;

/** body-parser / Express errors (http-errors) that carry a client status, e.g. 413 entity.too.large. */
const clientStatusOf = (e: unknown): number | undefined => {
  const { status, expose } = (e ?? {}) as { status?: unknown; expose?: unknown };
  return expose === true && typeof status === 'number' && status >= 400 && status < 500 ? status : undefined;
};

const isApiPath = (path: unknown): boolean => typeof path === 'string' && /^\/api(\/|$)/i.test(path);

/** 'Not Found' → 'not_found'. */
const codeForStatus = (status: number): string =>
  (STATUS_CODES[status] ?? 'error').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/**
 * Spec §8 for everything else under `/api/**` (M2): body-parser JSON errors, unknown routes, other
 * HttpExceptions and unexpected errors all answer `{ error: { code, message } }`. Other paths keep Nest's
 * default handling. AuthError is rendered the same way on every path, whichever global filter runs.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('OAuth2');

  constructor(@Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    if (exception instanceof AuthError) return renderAuthError(exception, host);
    const req = host.getType() === 'http' ? host.switchToHttp().getRequest() : undefined;
    if (!req || !isApiPath(req.path)) return new BaseExceptionFilter(this.adapterHost.httpAdapter).catch(exception, host);
    if (isMalformedRequest(exception, req)) return sendError(host, 422, 'validation_failed', 'Malformed request');
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body !== 'object' || body === null) {
        return sendError(host, status, codeForStatus(status), exception.message);
      }
      const { issues, message, code } = body as { issues?: unknown; message?: unknown; code?: unknown };
      const errCode = typeof code === 'string' ? code : codeForStatus(status);
      const list = Array.isArray(issues) ? issues : undefined;
      if (Array.isArray(message)) return sendError(host, status, errCode, message.join('; '), list ?? message);
      return sendError(host, status, errCode, exception.message, list);
    }
    const clientStatus = clientStatusOf(exception);
    if (clientStatus) return sendError(host, clientStatus, codeForStatus(clientStatus), STATUS_CODES[clientStatus] ?? 'Error');
    // Class name only: messages and stacks may carry request data.
    this.logger.error(`Unhandled error under /api: ${(exception as Error)?.name ?? typeof exception}`);
    sendError(host, 500, 'internal_error', 'Internal server error');
  }
}
