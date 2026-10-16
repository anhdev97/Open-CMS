import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
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

const createSchema = z.object({ name: z.string(), description: z.string().optional() }).strict();
const patchSchema = z
  .object({ name: z.string().optional(), description: z.string().optional() })
  .strict()
  .refine((v) => v.name !== undefined || v.description !== undefined, {
    message: 'name or description is required',
  });

@RequireRole('super_admin')
@Controller('api/admin/roles')
export class RolesController {
  constructor(@Inject(RoleService) private readonly roles: RoleService) {}

  @Get()
  async list() {
    return { data: (await this.roles.list()).map(roleJson) };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return roleJson(await this.roles.get(uuid(id)));
  }

  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown) {
    const input = parseBody(createSchema, body);
    return roleJson(await this.roles.create(input));
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const input = parseBody(patchSchema, body);
    return roleJson(await this.roles.update(uuid(id), input));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.roles.delete(uuid(id));
  }
}
