import * as path from 'node:path';
import type { NextConfig } from 'next';

const monorepoRoot = path.resolve(__dirname, '../..');

const nextConfig: NextConfig = {
  turbopack: { root: monorepoRoot },
  outputFileTracingRoot: monorepoRoot,
  // The storefront fetches itself on 127.0.0.1 while the browser may open localhost.
  allowedDevOrigins: ['127.0.0.1'],
};

export default nextConfig;
