import { UnprocessableEntityException } from '@nestjs/common';
import { PAGE_API_ID, validatePagePath } from '@opencloudcms/schema';
import type { HookRegistration } from '../options';

function checkPath(data: Record<string, unknown>): void {
  // A draft may omit the path (publish requires it); when present it must be valid.
  if (!('path' in data) || data.path == null || data.path === '') return;
  const r = validatePagePath(String(data.path));
  if (!r.ok) throw new UnprocessableEntityException({ code: r.code, message: r.message });
}

/** Registered by ContentRegistry for the core page type. `beforePublish` (unknown blocks) arrives with the block registry. */
export const pageHooks: HookRegistration['hooks'] = {
  beforeCreate: (data) => checkPath(data),
  beforeUpdate: (data) => checkPath(data),
};
