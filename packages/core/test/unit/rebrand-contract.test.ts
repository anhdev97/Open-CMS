import { describe, expect, it } from 'vitest';
import {
  OPENCLOUDCMS_DB,
  OPENCLOUDCMS_OPTIONS,
  OpenCloudCmsModule,
  type OpenCloudCmsModuleOptions,
  type ResolvedOpenCloudCmsOptions,
} from '../../src';

describe('@opencloudcms/core public API', () => {
  it('exports the OpenCloudCMS module and DI tokens', () => {
    expect(OpenCloudCmsModule.name).toBe('OpenCloudCmsModule');
    expect(OPENCLOUDCMS_OPTIONS.description).toBe('OPENCLOUDCMS_OPTIONS');
    expect(OPENCLOUDCMS_DB.description).toBe('OPENCLOUDCMS_DB');
  });

  it('exports the renamed option types', () => {
    const acceptsOptions = (_options: OpenCloudCmsModuleOptions): void => {};
    const acceptsResolvedOptions = (_options: ResolvedOpenCloudCmsOptions): void => {};

    expect(acceptsOptions).toBeTypeOf('function');
    expect(acceptsResolvedOptions).toBeTypeOf('function');
  });
});
