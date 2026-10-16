import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { AuthError } from '../errors';
import { RequireRole } from '../guard/current-user.decorator';
import { parseBody } from '../security/validate';
import { roleJson } from './role.mapper';
import { RoleService } from './role.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(value: string): string {
  if (!UUID.test(value)) throw new AuthError('not_found', 404, 'Not found');
  return value;
}

const putSchema = z.object({ roleIds: z.array(z.string()) }).strict();

@RequireRole('super_admin')
@Controller('api/admin/users')
export class UserRolesController {
  constructor(@Inject(RoleService) private readonly roles: RoleService) {}

  @Get(':id/roles')
  async list(@Param('id') id: string) {
    return { data: (await this.roles.listForUser(uuid(id))).map(roleJson) };
  }

  @Put(':id/roles')
  async replace(@Param('id') id: string, @Body() body: unknown) {
    const { roleIds } = parseBody(putSchema, body);
    const rows = await this.roles.replaceUserRoles(uuid(id), roleIds.map(uuid));
    return { data: rows.map(roleJson) };
  }

  @Post(':id/roles/:roleId')
  @HttpCode(204)
  async assign(@Param('id') id: string, @Param('roleId') roleId: string) {
    await this.roles.assign(uuid(id), uuid(roleId));
  }

  @Delete(':id/roles/:roleId')
  @HttpCode(204)
  async unassign(@Param('id') id: string, @Param('roleId') roleId: string) {
    await this.roles.unassign(uuid(id), uuid(roleId));
  }
}
