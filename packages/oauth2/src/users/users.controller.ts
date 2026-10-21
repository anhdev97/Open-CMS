import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { OAUTH2_DB } from '../constants';
import type { AuthTables } from '../db/types';
import { AuthError } from '../errors';
import { CurrentUser, RequirePermission, type RequestUser } from '../guard/current-user.decorator';
import { normalizeEmail } from '../security/email';
import { parseBody } from '../security/validate';
import { UserService } from './user.service';

export interface UserView {
  id: string;
  email: string;
  name: string;
  status: string;
  /** Group keys (Task 13 replaces this with `groups`). */
  roles: string[];
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
  })
  .strict();

const patchSchema = z
  .object({ name: z.string().min(1).max(255).optional(), status: z.enum(['active', 'disabled']).optional() })
  .strict()
  .refine((v) => v.name !== undefined || v.status !== undefined, { message: 'name or status is required' });

const passwordSchema = z.object({ password: z.string() }).strict();

@RequirePermission('settings.users')
@Controller('api/admin/users')
export class UsersController {
  constructor(
    @Inject(OAUTH2_DB) private readonly db: Kysely<AuthTables>,
    @Inject(UserService) private readonly users: UserService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Users + groups + identities in three queries total (no per-user lookups). */
  private async views(ids?: string[]): Promise<UserView[]> {
    let uq = this.db.selectFrom('auth_users').select(['id', 'email', 'name', 'status', 'last_login_at']).orderBy('created_at').orderBy('id');
    if (ids) uq = uq.where('id', 'in', ids);
    const rows = await uq.execute();
    if (rows.length === 0) return [];
    const userIds = rows.map((r) => r.id);
    const [roles, identities] = await Promise.all([
      this.db
        .selectFrom('auth_user_groups as ug')
        .innerJoin('auth_groups as g', 'g.id', 'ug.group_id')
        .select(['ug.user_id', 'g.key'])
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
      roles: roles.filter((r) => r.user_id === u.id).map((r) => r.key),
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
    const created = await this.users.create({ ...input, actorId: actor.id });
    return { data: await this.view(created.id) };
  }

  @Patch(':id')
  async update(@Param('id') rawId: string, @Body() body: unknown, @CurrentUser() actor: RequestUser): Promise<{ data: UserView }> {
    const id = uuid(rawId);
    const input = parseBody(patchSchema, body);
    if (!(await this.users.findById(id))) throw new AuthError('not_found', 404, 'User not found');
    if (input.status !== undefined) await this.users.setStatus(id, input.status, actor.id);
    if (input.name !== undefined) {
      await this.db.updateTable('auth_users').set({ name: input.name, updated_at: new Date() }).where('id', '=', id).execute();
    }
    return { data: await this.view(id) };
  }

  @Post(':id/password')
  @HttpCode(204)
  async resetPassword(@Param('id') rawId: string, @Body() body: unknown, @CurrentUser() actor: RequestUser): Promise<void> {
    const id = uuid(rawId);
    const { password } = parseBody(passwordSchema, body);
    await this.users.setPassword(id, password);
    await this.users.revokeAll(id);
    await this.audit.record({ type: 'password_reset_by_admin', userId: id, actorId: actor.id });
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') rawId: string, @CurrentUser() actor: RequestUser): Promise<void> {
    await this.users.delete(uuid(rawId), actor.id);
  }

  @Delete(':id/identities/:identityId')
  @HttpCode(204)
  async removeIdentity(@Param('id') rawId: string, @Param('identityId') rawIdentityId: string): Promise<void> {
    const res = await this.db
      .deleteFrom('auth_user_identities')
      .where('id', '=', uuid(rawIdentityId))
      .where('user_id', '=', uuid(rawId))
      .executeTakeFirst();
    if (Number(res.numDeletedRows) === 0) throw new AuthError('not_found', 404, 'Identity not found');
  }
}
