/**
 * Content groups API (dev only). Writes `src/content-groups.ts` with the codegen printer and keeps the
 * in-memory registry in step. Shares the schema write queue with the Content Type Builder.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Body, ConflictException, Controller, Get, Inject, Injectable, Put, UnprocessableEntityException } from '@nestjs/common';
import { RequirePermission } from '@opencloudcms/oauth2';
import { contentGroupsFile, printContentGroupsFile } from '@opencloudcms/codegen';
import { validateContentGroups, type ContentGroupDefinition } from '@opencloudcms/schema';
import { OPENCLOUDCMS_OPTIONS, type ResolvedOpenCloudCmsOptions } from './options';
import { ContentRegistry } from './registry.service';
import { SchemaBuilderService } from './schema-builder';
import { SchemaWriteQueue } from './schema-write-queue';

@Injectable()
export class ContentGroupsService {
  constructor(
    @Inject(OPENCLOUDCMS_OPTIONS) private readonly options: ResolvedOpenCloudCmsOptions,
    @Inject(ContentRegistry) private readonly registry: ContentRegistry,
    @Inject(SchemaBuilderService) private readonly builder: SchemaBuilderService,
    @Inject(SchemaWriteQueue) private readonly queue: SchemaWriteQueue,
  ) {}

  list() {
    return { groups: this.registry.groups(), editable: this.options.schemaEditable };
  }

  replace(groups: unknown) {
    this.builder.assertEditable();
    return this.queue.run(async () => {
      const issues = validateContentGroups(groups);
      if (issues.length) throw new UnprocessableEntityException({ message: 'Invalid content groups', issues });
      const next = groups as ContentGroupDefinition[];
      const keep = new Set(next.map((g) => g.key));
      const inUse = new Map<string, string[]>();
      for (const def of this.registry.all()) {
        if (def.group && !keep.has(def.group)) inUse.set(def.group, [...(inUse.get(def.group) ?? []), def.apiId]);
      }
      if (inUse.size) {
        throw new ConflictException({
          code: 'group_in_use',
          message: 'Content groups are still used by content types',
          issues: [...inUse].map(([key, apiIds]) => ({ path: [key], message: apiIds.join(', ') })),
        });
      }
      const file = contentGroupsFile(this.options.config);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, printContentGroupsFile(next));
      this.registry.reloadGroups(next);
      return { groups: this.registry.groups() };
    });
  }
}

@RequirePermission('settings.content-types')
@Controller('api/admin')
export class ContentGroupsController {
  constructor(@Inject(ContentGroupsService) private readonly service: ContentGroupsService) {}

  @Get('content-groups')
  list() {
    return this.service.list();
  }

  @Put('content-groups')
  replace(@Body() body: { groups?: unknown }) {
    return this.service.replace(body?.groups);
  }
}
