/** Minimal system APIs so taxonomy fields are usable in v0. Asset routes live in @opencms/assets. */
import { BadRequestException, Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { RequirePermission } from '@opencms/oauth2';
import { SYSTEM_TABLES } from '@opencms/schema';
import { OPENCMS_DB } from './options';

@Controller('api/admin')
export class SystemController {
  constructor(@Inject(OPENCMS_DB) private readonly db: Kysely<any>) {}

  @RequirePermission('content.read')
  @Get('taxonomies')
  async taxonomies() {
    return { data: await this.db.selectFrom(SYSTEM_TABLES.taxonomies).selectAll().orderBy('slug').execute() };
  }

  @RequirePermission('settings.content-types')
  @Post('taxonomies')
  async createTaxonomy(@Body() body: { slug?: string; name?: string }) {
    if (!body?.slug || !/^[a-z0-9-]+$/.test(body.slug) || !body.name) throw new BadRequestException('slug (kebab-case) and name are required');
    const row = await this.db.insertInto(SYSTEM_TABLES.taxonomies).values({ slug: body.slug, name: body.name }).returningAll().executeTakeFirstOrThrow();
    return { data: row };
  }

  @RequirePermission('content.read')
  @Get('taxonomies/:slug/terms')
  async terms(@Param('slug') slug: string) {
    const data = await this.db
      .selectFrom(`${SYSTEM_TABLES.taxonomyTerms} as t`)
      .innerJoin(`${SYSTEM_TABLES.taxonomies} as x`, 'x.id', 't.taxonomy_id')
      .selectAll('t')
      .where('x.slug', '=', slug)
      .orderBy('t.sort_order')
      .execute();
    return { data };
  }

  @RequirePermission('content.update')
  @Post('taxonomies/:slug/terms')
  async createTerm(@Param('slug') slug: string, @Body() body: { slug?: string; name?: Record<string, string>; parentId?: string; sortOrder?: number }) {
    if (!body?.slug || !body.name) throw new BadRequestException('slug and name ({ locale: label }) are required');
    const tax = await this.db.selectFrom(SYSTEM_TABLES.taxonomies).select('id').where('slug', '=', slug).executeTakeFirst();
    if (!tax) throw new BadRequestException(`Unknown taxonomy "${slug}"`);
    const row = await this.db
      .insertInto(SYSTEM_TABLES.taxonomyTerms)
      .values({ taxonomy_id: tax.id, slug: body.slug, name: JSON.stringify(body.name), parent_id: body.parentId ?? null, sort_order: body.sortOrder ?? 0 })
      .returningAll()
      .executeTakeFirstOrThrow();
    return { data: row };
  }
}
