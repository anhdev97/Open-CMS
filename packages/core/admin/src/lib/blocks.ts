import type { ComposedBlockSpec, LocalizedText } from '@opencloudcms/schema';
import { api } from './api';
import { ApiError } from './api-error';

export type BlockSource = 'core' | 'code' | 'composed';

export interface BlockListItem {
  name: string;
  label: string | LocalizedText;
  category: string | null;
  source: BlockSource;
  file?: string;
  version: number;
  /** Distinct pages (draft or published, any locale) that use the block. */
  usage: number;
  problems: string[];
}

export interface BlocksResponse {
  editable: boolean;
  composedIndexWired: boolean;
  data: BlockListItem[];
  loadErrors: { file: string; message: string }[];
}

export interface BlockDetail {
  spec: ComposedBlockSpec;
  file: string;
  usage: number;
  problems: string[];
}

export interface BlockFilesResult {
  files: string[];
}

export interface EjectResult extends BlockFilesResult {
  file: string;
  importLine: string;
}

/** The lines a project needs in `src/blocks/index.ts` for the managed `composed.ts` to be picked up. */
export const COMPOSED_INDEX_IMPORT = "import { composedBlocks } from './composed';";
export const COMPOSED_INDEX_SPREAD = '...composedBlocks';

const base = '/api/admin/blocks';
const url = (name: string) => `${base}/${encodeURIComponent(name)}`;

export function listBlocks(): Promise<BlocksResponse> {
  return api<BlocksResponse>(base);
}

export function getBlock(name: string): Promise<BlockDetail> {
  return api<BlockDetail>(url(name));
}

/** `confirmBreaking` is sent only when true: the server demands the boolean `true`. */
export function saveBlock(name: string, spec: ComposedBlockSpec, opts: { confirmBreaking?: boolean } = {}): Promise<{ spec: ComposedBlockSpec; files: string[] }> {
  return api(url(name), { method: 'PUT', json: opts.confirmBreaking ? { spec, confirmBreaking: true } : { spec } });
}

export function deleteBlock(name: string, opts: { force?: boolean } = {}): Promise<BlockFilesResult> {
  return api(`${url(name)}${opts.force ? '?force=1' : ''}`, { method: 'DELETE' });
}

export function ejectBlock(name: string): Promise<EjectResult> {
  return api(`${url(name)}/eject`, { method: 'POST' });
}

export type BlockAction = 'edit' | 'eject' | 'delete';

/** Row actions: only Builder (composed) blocks, and only when the server allows schema edits. */
export function blockActions(source: BlockSource, editable: boolean): BlockAction[] {
  return source === 'composed' && editable ? ['edit', 'eject', 'delete'] : [];
}

const ERROR_KEYS: Record<string, string> = {
  invalid_block: 'blocks.errors.invalidBlock',
  name_immutable: 'blocks.errors.nameImmutable',
  block_name_taken: 'blocks.errors.nameTaken',
  block_in_use: 'blocks.errors.inUse',
  composed_blocks_broken: 'blocks.errors.composedBroken',
  eject_target_exists: 'blocks.errors.ejectTargetExists',
  not_composed: 'blocks.errors.notComposed',
};

/** i18n key for a known blocks API error code; `null` shows the server message instead. */
export function blockErrorMessageKey(e: unknown): string | null {
  if (!(e instanceof ApiError)) return null;
  return Object.hasOwn(ERROR_KEYS, e.code) ? ERROR_KEYS[e.code]! : null;
}

/** The two lines to add to `src/blocks/index.ts` after an eject: the import and the entry for the `defineBlocks` list. */
export function ejectInstructions(name: string, importLine: string): { importLine: string; listEntry: string } {
  return { importLine, listEntry: `${name},` };
}
