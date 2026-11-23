import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.fn();
vi.mock('../../admin/src/lib/api', () => ({ api: (...a: unknown[]) => api(...a) }));

import { blockActions, blockErrorMessageKey, deleteBlock, ejectBlock, getBlock, listBlocks, saveBlock, COMPOSED_INDEX_IMPORT, COMPOSED_INDEX_SPREAD } from '../../admin/src/lib/blocks';
import { ApiError } from '../../admin/src/lib/api-error';

beforeEach(() => api.mockReset());

describe('block client', () => {
  it('listBlocks GETs /api/admin/blocks', async () => {
    api.mockResolvedValue({ editable: true, composedIndexWired: true, data: [], loadErrors: [] });
    await listBlocks();
    expect(api).toHaveBeenCalledWith('/api/admin/blocks');
  });
  it('getBlock encodes the name', async () => {
    api.mockResolvedValue({ spec: {}, file: 'f', usage: 0, problems: [] });
    await getBlock('ProductCard');
    expect(api).toHaveBeenCalledWith('/api/admin/blocks/ProductCard');
  });
  it('saveBlock PUTs { spec } and adds confirmBreaking only when asked', async () => {
    api.mockResolvedValue({ spec: {}, files: [] });
    const spec = { name: 'ProductCard' } as never;
    await saveBlock('ProductCard', spec);
    expect(api).toHaveBeenLastCalledWith('/api/admin/blocks/ProductCard', { method: 'PUT', json: { spec } });
    await saveBlock('ProductCard', spec, { confirmBreaking: true });
    expect(api).toHaveBeenLastCalledWith('/api/admin/blocks/ProductCard', { method: 'PUT', json: { spec, confirmBreaking: true } });
  });
  it('deleteBlock DELETEs, with ?force=1 when forced', async () => {
    api.mockResolvedValue({ files: [] });
    await deleteBlock('ProductCard');
    expect(api).toHaveBeenLastCalledWith('/api/admin/blocks/ProductCard', { method: 'DELETE' });
    await deleteBlock('ProductCard', { force: true });
    expect(api).toHaveBeenLastCalledWith('/api/admin/blocks/ProductCard?force=1', { method: 'DELETE' });
  });
  it('ejectBlock POSTs to /eject', async () => {
    api.mockResolvedValue({ file: 'a', importLine: 'b', files: [] });
    await ejectBlock('ProductCard');
    expect(api).toHaveBeenCalledWith('/api/admin/blocks/ProductCard/eject', { method: 'POST' });
  });
});

describe('blockActions', () => {
  it('composed + editable: edit, eject, delete', () => {
    expect(blockActions('composed', true)).toEqual(['edit', 'eject', 'delete']);
  });
  it('composed but read-only, code and core: none', () => {
    expect(blockActions('composed', false)).toEqual([]);
    expect(blockActions('code', true)).toEqual([]);
    expect(blockActions('core', true)).toEqual([]);
  });
});

describe('blockErrorMessageKey', () => {
  it.each([
    ['invalid_block', 'blocks.errors.invalidBlock'],
    ['name_immutable', 'blocks.errors.nameImmutable'],
    ['block_name_taken', 'blocks.errors.nameTaken'],
    ['block_in_use', 'blocks.errors.inUse'],
    ['composed_blocks_broken', 'blocks.errors.composedBroken'],
    ['eject_target_exists', 'blocks.errors.ejectTargetExists'],
    ['not_composed', 'blocks.errors.notComposed'],
  ])('%s', (code, key) => {
    expect(blockErrorMessageKey(new ApiError(409, code, 'x'))).toBe(key);
  });
  it('null for unknown codes and non-API errors', () => {
    expect(blockErrorMessageKey(new ApiError(500, 'boom', 'x'))).toBeNull();
    expect(blockErrorMessageKey(new Error('x'))).toBeNull();
  });
});

describe('composed index lines', () => {
  it('are exact', () => {
    expect(COMPOSED_INDEX_IMPORT).toBe("import { composedBlocks } from './composed';");
    expect(COMPOSED_INDEX_SPREAD).toBe('...composedBlocks');
  });
});
