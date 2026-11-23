'use client';

import { createContext } from 'react';
import type { BlockRegistry } from '@opencloudcms/core/blocks';

/**
 * The project's block registry (`<AdminApp blocks={...} />`); null = core blocks (the editor builds
 * `defineBlocks(coreBlocks)` itself, so this module stays out of the main admin chunk's dependencies on blocks).
 */
export const BlocksContext = createContext<BlockRegistry | null>(null);
