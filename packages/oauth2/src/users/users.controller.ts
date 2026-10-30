import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { OAUTH2_DB } from '../constants';
import type { AuthTables } from '../db/types';
import { AuthError } from '../errors';
import { CurrentUser, RequirePermission, type RequestUser } from '../guard/current-user.decorator';
import { normalizeEmail } from '../security/email';
import { parseBody } from '../security/validate';
import { UserService } from './user.service';
import { StepUpService } from '../sso-management/step-up.service';
import type { AuthenticatedRequest } from '../guard/session-auth.service';

export interface UserView {
  id: string;
  email: string;
  name: string;
  status: string;
  /** Sorted by key. */
  groups: Array<{ id: string; key: string; name: string }>;
  lastLoginAt: Date | null;
  identities: Array<{ id: string; provider: string; subject: string; email: string | null }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Params that are not UUIDs can never match a row: answer 404 instead of a Postgres cast error (500). */
function uuid(value: string): string {
  if (!UUID.test(value)) throw new AuthError('not_found', 404, 'Not found');
  return value;
}

const createSchema = z
  .object({
    email: z.string().transform(normalizeEmail).pipe(z.string().email().max(320)),
    name: z.string().min(1).max(255),
    password: z.string().optional(),
    groupIds: z.array(z.string().regex(UUID, 'invalid group id')).min(1).max(100),
  })
  .strict();

const patchSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    status: z.enum(['active', 'disabled']).optional(),
    groupIds: z.array(z.string().regex(UUID, 'invalid group id')).max(100).optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.status !== undefined || v.groupIds !== undefined, {
    message: 'name, status or groupIds is required',
  });

const passwordSchema = z.object({ password: z.string() }).strict();

const actorOf = (u: RequestUser) => ({ id: u.id, isSuperAdmin: u.isSuperAdmin, permissions: u.permissions });

@RequirePermission('settings.users')
@Controller('api/admin/users')
export class UsersController {
  constructor(
    @Inject(OAUTH2_DB) private readonly db: Kysely<AuthTables>,
    @Inject(UserService) private readonly users: UserService,
    @Inject(StepUpService) private readonly stepUp: StepUpService,
  ) {}

  /** Users + groups + identities in three queries total (no per-user lookups). */
  private async views(ids?: string[]): Promise<UserView[]> {
    let uq = this.db.selectFrom('auth_users').select(['id', 'email', 'name', 'status', 'last_login_at']).orderBy('created_at').orderBy('id');
    if (ids) uq = uq.where('id', 'in', ids);
    const rows = await uq.execute();
    if (rows.length === 0) return [];
    const userIds = rows.map((r) => r.id);
    const [groups, identities] = await Promise.all([
      this.db
        .selectFrom('auth_user_groups as ug')
        .innerJoin('auth_groups as g', 'g.id', 'ug.group_id')
        .select(['ug.user_id', 'g.id', 'g.key', 'g.name'])
        .where('ug.user_id', 'in', userIds)
        .orderBy('g.key')
        .execute(),
      this.db
        .selectFrom('auth_user_identities')
        .select(['id', 'user_id', 'provider', 'subject', 'email'])
        .where('user_id', 'in', userIds)
        .orderBy('created_at')
        .orderBy('id')
        .execute(),
    ]);
    return rows.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      status: u.status,
      groups: groups.filter((g) => g.user_id === u.id).map((g) => ({ id: g.id, key: g.key, name: g.name })),
      lastLoginAt: u.last_login_at,
      identities: identities
        .filter((i) => i.user_id === u.id)
        .map((i) => ({ id: i.id, provider: i.provider, subject: i.subject, email: i.email })),
    }));
  }

  private async view(id: string): Promise<UserView> {
    const [v] = await this.views([id]);
    if (!v) throw new AuthError('not_found', 404, 'User not found');
    return v;
  }

  @Get()
  async list(): Promise<{ data: UserView[] }> {
    return { data: await this.views() };
  }

  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown, @CurrentUser() actor: RequestUser): Promise<{ data: UserView }> {
    const input = parseBody(createSchema, body);
    const created = await this.users.create({ ...input, actorId: actor.id, actor: actorOf(actor) });
    return { data: await this.view(created.id) };
  }

  @Patch(':id')
  async update(@Param('id') rawId: string, @Body() body: unknown, @CurrentUser() actor: RequestUser): Promise<{ data: UserView }> {
    const id = uuid(rawId);
    const input = parseBody(patchSchema, body);
    await this.users.update(id, input, actorOf(actor));
    return { data: await this.view(id) };
  }

  @Post(':id/password')
  @HttpCode(204)
  async resetPassword(@Param('id') rawId: string, @Body() body: unknown, @CurrentUser() actor: RequestUser): Promise<void> {
    const id = uuid(rawId);
    const { password } = parseBody(passwordSchema, body);
    await this.users.resetPassword(id, password, actorOf(actor));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') rawId: string, @CurrentUser() actor: RequestUser): Promise<void> {
    await this.users.delete(uuid(rawId), actorOf(actor));
  }

  @Delete(':id/identities/:identityId')
  @HttpCode(204)
  async removeIdentity(
    @Param('id') rawId: string,
    @Param('identityId') rawIdentityId: string,
    @CurrentUser() actor: RequestUser,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    if (!req.authSession) throw new AuthError('unauthenticated', 401);
    await this.stepUp.assertRecent(req.authSession.idHash);
    await this.users.unlinkIdentity(uuid(rawId), uuid(rawIdentityId), actorOf(actor));
  }
}
