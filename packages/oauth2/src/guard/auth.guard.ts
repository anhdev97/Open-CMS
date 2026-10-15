import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import type { OAuth2Config } from '../config/schema';
import { OAUTH2_CONFIG, PUBLIC_PATH_PREFIXES } from '../constants';
import { AuthError } from '../errors';
import { assertSameOrigin } from '../security/origin';
import { SetupState } from '../setup/setup-state';
import { REQUIRED_ROLES_KEY } from './current-user.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';
import { SessionAuthenticator, type AuthenticatedRequest } from './session-auth.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Scope is decided from the matched route pattern (set by Express before guards run), lower-cased:
 * Express routes case-insensitively, so `/API/x` reaches an `api/x` handler and must be guarded too.
 */
const scopePath = (req: AuthenticatedRequest): string => {
  const route = (req as { route?: { path?: unknown } }).route?.path;
  return (typeof route === 'string' ? route : req.path ?? '').toLowerCase();
};

/**
 * Global guard (APP_GUARD) for `/api/**` (spec §6.5). Routes outside `/api` (host app, `/admin`, `/oauth2`
 * Nest routes) pass untouched; `@Public()` handlers pass.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(OAUTH2_CONFIG) private readonly cfg: OAuth2Config,
    @Inject(PUBLIC_PATH_PREFIXES) private readonly publicPrefixes: string[],
    @Inject(SetupState) private readonly setup: SetupState,
    @Inject(SessionAuthenticator) private readonly auth: SessionAuthenticator,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const path = scopePath(req);
    if (path !== '/api' && !path.startsWith('/api/')) return true;
    if (this.publicPrefixes.some((p) => path.startsWith(p))) return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    if (await this.setup.isRequired()) throw new AuthError('setup_required', 409, 'Setup is required');

    // Step 1: Origin on writes, before touching the session.
    if (!SAFE_METHODS.has(req.method.toUpperCase())) {
      const origin = req.headers.origin;
      assertSameOrigin(Array.isArray(origin) ? origin[0] : origin, this.cfg.publicUrl);
    }

    const user = await this.auth.authenticate(req, ctx.switchToHttp().getResponse<Response>());

    const roles = this.reflector.getAllAndOverride<string[] | undefined>(REQUIRED_ROLES_KEY, targets);
    if (roles?.length && !roles.every((r) => user.roles.includes(r))) {
      throw new AuthError('forbidden', 403, 'Missing role');
    }
    return true;
  }
}
