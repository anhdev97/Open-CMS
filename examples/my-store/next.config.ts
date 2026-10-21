import * as path from 'node:path';
import type { NextConfig } from 'next';

// In the monorepo @opencms/core is a workspace symlink outside this directory; Turbopack and output
// tracing only follow files under their root, so both point at the repo root.
const monorepoRoot = path.resolve(__dirname, '../..');

// Server components may import the i18n helpers from @opencms/core: under the `react-server` condition the
// package resolves to a NestJS-free module. Client components ('use client') import them from @opencms/core/admin.
const nextConfig: NextConfig = {
  turbopack: { root: monorepoRoot },
  outputFileTracingRoot: monorepoRoot,
};

export default nextConfig;
