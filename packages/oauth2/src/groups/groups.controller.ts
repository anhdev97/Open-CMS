import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuthError } from '../errors';
import { CurrentUser, RequirePermission, type RequestUser } from '../guard/current-user.decorator';
import { isPermission, PERMISSIONS, type Permission } from '../permissions';
import { parseBody } from '../security/validate';
import { GroupsService, type GroupView } from './groups.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Params that are not UUIDs can never match a row: 404 instead of a Postgres cast error. */
function uuid(value: string): string {
  if (!UUID.test(value)) throw new AuthError('not_found', 404, 'Not found');
  return value;
}

const KEY = /^[a-z][a-z0-9-]{0,63}$/;
const name = z.string().min(1).max(100);
const roles = z.array(
  z.string().refine(isPermission, (v) => ({ message: `unknown permission: ${v}` })),
) as unknown as z.ZodType<Permission[]>;

const createSchema = z.object({ key: z.string().regex(KEY, 'invalid key'), name, roles }).strict();

const patchSchema = z
  .object({ name: name.optional(), roles: roles.optional() })
  .strict()
  .refine((v) => v.name !== undefined || v.roles !== undefined, { message: 'name or roles is required' });

const actorOf = (u: RequestUser) => ({ id: u.id, isSuperAdmin: u.isSuperAdmin, permissions: u.permissions });

/** Permission groups (spec B §4.3); every write needs `settings.groups`. */
@RequirePermission('settings.groups')
@Controller('api/admin/groups')
export class GroupsController {
  constructor(@Inject(GroupsService) private readonly groups: GroupsService) {}

  /**
   * Readable with `settings.groups` or `settings.users`: the users screen assigns groups (spec B §6.2), so a
   * user manager must be able to list them.
   */
  @Get()
  @RequirePermission()
  async list(@CurrentUser() user: RequestUser): Promise<{ data: GroupView[] }> {
    if (!user.permissions.includes('settings.groups') && !user.permissions.includes('settings.users')) {
      throw new AuthError('forbidden', 403, 'Missing permission: settings.groups');
    }
    return { data: await this.groups.list() };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('settings.groups')
  async create(@Body() body: unknown, @CurrentUser() user: RequestUser): Promise<{ data: GroupView }> {
    return { data: await this.groups.create(parseBody(createSchema, body), actorOf(user)) };
  }

  @Patch(':id')
  @RequirePermission('settings.groups')
  async update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: RequestUser): Promise<{ data: GroupView }> {
    const gid = uuid(id);
    return { data: await this.groups.update(gid, parseBody(patchSchema, body), actorOf(user)) };
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('settings.groups')
  async remove(@Param('id') id: string, @CurrentUser() user: RequestUser): Promise<void> {
    await this.groups.delete(uuid(id), actorOf(user));
  }
}

/** The fixed permission catalogue (spec B §3.1, §4.3). */
@RequirePermission('settings.groups')
@Controller('api/admin/permissions')
export class PermissionsController {
  @Get()
  @RequirePermission('settings.groups')
  list(): { data: readonly Permission[] } {
    return { data: [...PERMISSIONS] };
  }
}
