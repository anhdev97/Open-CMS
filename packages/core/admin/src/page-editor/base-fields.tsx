'use client';

// Base pages in the page builder (spec §4, §5): the page's base choice and region modes as root fields, the structure
// rules of base pages and pages, overlay name warnings and the base publish confirm. Relative imports only (root vitest).
import { TriangleAlertIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CustomFieldRender, Field } from '@puckeditor/core';
import { composeWithBase, PUCK_FORMAT_VERSION, type BlockRegistry, type PuckData, type StoredPageContent } from '@opencloudcms/core/blocks';
import { localizedText, type Locale, type PageKind } from '@opencloudcms/schema';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { t } from '../i18n';
import type { BaseUsage } from '../lib/pages';
import type { OverlayNameEntry } from '../block-builder/ActionField';
import { FieldShell, fieldLabel } from './FieldShell';
import {
  BASE_DEFAULT,
  BASE_FIELD,
  BASE_HINT_FIELD,
  BASE_NONE,
  REGION_MODE_PREFIX,
  REGION_PREFIX,
  layoutToRootProps,
  rootPropsToLayout,
  walkItems,
} from './field-logic';

export { BASE_DEFAULT, BASE_FIELD, BASE_HINT_FIELD, BASE_NONE, REGION_MODE_PREFIX, REGION_PREFIX, layoutToRootProps, rootPropsToLayout };

type Props = Record<string, unknown>;
type Item = { type: string; props: Props };
const isObj = (v: unknown): v is Props => !!v && typeof v === 'object' && !Array.isArray(v);
const isItem = (v: unknown): v is Item => isObj(v) && typeof v.type === 'string' && isObj(v.props);

/** Root drop zone of the editor canvas (Puck's `root:default-zone`). */
export const ROOT_ZONE = 'root:default-zone';

/** Names of the layout blocks (root block of a base page) of the registry. */
export const layoutBlockNames = (registry: BlockRegistry): string[] => registry.list.filter((d) => d.kind === 'layout').map((d) => d.name);

const regionKeysOfDef = (registry: BlockRegistry, type: string): string[] =>
  Object.keys(registry.get(type)?.fields ?? {}).filter((k) => k.startsWith(REGION_PREFIX));

/** Every region name declared by a layout block of the registry (the root slot fields a page may fill), in order. */
export function registryRegionNames(registry: BlockRegistry): string[] {
  const out: string[] = [];
  for (const name of layoutBlockNames(registry)) {
    for (const k of regionKeysOfDef(registry, name)) {
      const r = k.slice(REGION_PREFIX.length);
      if (!out.includes(r)) out.push(r);
    }
  }
  return out;
}

/** Region names of a layout block item: its block's region fields, then other `region__*` props (as the website composes). */
export function frameRegionNames(frame: Item, registry: BlockRegistry): string[] {
  const keys = regionKeysOfDef(registry, frame.type);
  for (const k of Object.keys(frame.props)) if (k.startsWith(REGION_PREFIX) && !keys.includes(k)) keys.push(k);
  return keys.map((k) => k.slice(REGION_PREFIX.length));
}

/** Region names of a base page's stored content, or null when its root is not one layout block (`composeWithBase`). */
export function baseRegionNames(content: unknown, registry: BlockRegistry): string[] | null {
  if (!isObj(content)) return null;
  const base = content as unknown as StoredPageContent;
  const own: StoredPageContent = { format: 'puck', formatVersion: PUCK_FORMAT_VERSION, data: { root: { props: {} }, content: [] } };
  const composed = composeWithBase(base, own, null, registry);
  const frame = composed === own ? null : composed.data.content[0];
  return isItem(frame) ? frameRegionNames(frame, registry) : null;
}

/** Label of a region: the region field label of a layout block declaring it (in `locale`), else its name. */
export function regionLabel(registry: BlockRegistry, name: string, locale: Locale): string {
  for (const block of layoutBlockNames(registry)) {
    const f = registry.get(block)?.fields[`${REGION_PREFIX}${name}`] as { label?: unknown } | undefined;
    if (f?.label) return localizedText(f.label as never, locale, name);
  }
  return name;
}

export interface BaseOption {
  documentId: string;
  title?: string | null;
  isDefault?: boolean | null;
}

/** `Base page` select: Default (name of the default base) = layout null, each base by title, None = no base page. */
export function basePageField(bases: readonly BaseOption[]): Field {
  const def = bases.find((b) => b.isDefault);
  const title = (b: BaseOption) => b.title || t('content.untitled');
  return {
    type: 'select',
    label: t('pageEditor.root.basePage'),
    options: [
      { label: def ? t('pageEditor.root.baseDefault', { name: title(def) }) : t('pageEditor.root.baseDefaultNone'), value: BASE_DEFAULT },
      ...bases.map((b) => ({ label: title(b), value: b.documentId })),
      { label: t('pageEditor.root.baseNone'), value: BASE_NONE },
    ],
  } as Field;
}

/** One region's mode (Default / Replace for this page / Hide); unset shows as Default. */
export const RegionModeField: CustomFieldRender<string> = ({ field, name, id, value, onChange, readOnly }) => {
  const options = ((field.metadata as { options?: { label: string; value: string }[] } | undefined)?.options ?? []);
  const current = value || 'default';
  return (
    <FieldShell id={id} label={fieldLabel(field, name)} as="legend">
      <div className="flex flex-col gap-1">
        {options.map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-sm">
            <input type="radio" name={id} value={o.value} checked={current === o.value} disabled={readOnly} onChange={() => onChange(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
    </FieldShell>
  );
};

const BaseHint: CustomFieldRender<unknown> = () => <p className="text-xs text-muted-foreground">{t('pageEditor.root.baseHint')}</p>;

/** Root slot field of a replaced region (layout blocks never go in a region); `label` names it in the outline. */
export const regionSlotField = (layouts: readonly string[], label?: string): Field =>
  ({ type: 'slot', ...(label ? { label } : {}), ...(layouts.length ? { disallow: [...layouts] } : {}) }) as Field;

/**
 * Root `resolveFields` of a page: the static fields (slots left out) plus, for the base page it uses (the default one
 * included: `regionsOf('default')`), one mode field per region and a slot field `region__<name>` per replaced region.
 * Default without a usable default base page: a hint. Blocks of a region that is no longer replaced stay in the data
 * (switching back restores them); the website ignores them.
 */
export function pageRootResolveFields(o: { regionsOf: (baseId: string) => Promise<string[] | null>; registry: BlockRegistry; locale?: Locale }) {
  const layouts = layoutBlockNames(o.registry);
  return async (data: { props?: Props }, params: { fields: Record<string, Field> }): Promise<Record<string, Field>> => {
    const props = data.props ?? {};
    const out: Record<string, Field> = {};
    for (const [k, f] of Object.entries(params.fields)) if ((f as { type?: string }).type !== 'slot') out[k] = f;
    const raw = props[BASE_FIELD];
    const choice = raw === undefined || raw === BASE_DEFAULT ? 'default' : raw;
    if (typeof choice !== 'string' || choice === BASE_NONE) return out;
    const found = await o.regionsOf(choice).catch(() => null);
    if (choice === 'default' && found === null) {
      out[BASE_HINT_FIELD] = { type: 'custom', render: BaseHint } as Field;
      return out;
    }
    const regions = found ?? [];
    for (const r of regions) {
      out[`${REGION_MODE_PREFIX}${r}`] = {
        type: 'custom',
        label: t('pageEditor.root.regionMode', { name: regionLabel(o.registry, r, o.locale ?? 'en-US') }),
        render: RegionModeField,
        metadata: {
          options: [
            { label: t('pageEditor.root.regionDefault'), value: 'default' },
            { label: t('pageEditor.root.regionReplace'), value: 'replace' },
            { label: t('pageEditor.root.regionHide'), value: 'hide' },
          ],
        },
      } as Field;
      if (props[`${REGION_MODE_PREFIX}${r}`] === 'replace') {
        out[`${REGION_PREFIX}${r}`] = params.fields[`${REGION_PREFIX}${r}`] ?? regionSlotField(layouts, regionLabel(o.registry, r, o.locale ?? 'en-US'));
      }
    }
    return out;
  };
}

/**
 * Why the editor data breaks the page structure, as an i18n key, or null. Base pages: exactly one block at the root,
 * a layout block, and no other layout block anywhere. Pages: no layout block anywhere (also not in a replaced region).
 */
export function structureViolation(kind: PageKind, data: PuckData, registry: BlockRegistry): string | null {
  const layouts = new Set(layoutBlockNames(registry));
  let count = 0;
  walkItems(data, registry, (it) => {
    if (layouts.has(it.type)) count++;
  });
  // Pages and detail templates hold no layout block (a base page frames them).
  if (kind !== 'base') return count ? 'pageEditor.layoutMisplaced' : null;
  const root = Array.isArray(data.content) ? (data.content as unknown[]) : [];
  if (root.length > 1) return 'pageEditor.base.oneLayout';
  const top = root[0];
  const topIsLayout = isItem(top) && layouts.has(top.type);
  if (root.length === 1 && !topIsLayout) return 'pageEditor.base.layoutOnly';
  return count > (topIsLayout ? 1 : 0) ? 'pageEditor.layoutMisplaced' : null;
}

export interface OverlayNameIssues {
  /** Valid names placed more than once on the page (its own overlays and its base page's together). */
  duplicates: string[];
  /** Names that are not valid overlay names (buttons cannot target them). */
  invalid: string[];
}

/** Duplicate and invalid overlay names of a page together with its base page's, or null when there are none. */
export function overlayNameIssues(page: readonly OverlayNameEntry[], base: readonly OverlayNameEntry[]): OverlayNameIssues | null {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const invalid: string[] = [];
  for (const e of [...page, ...base]) {
    if (!e.valid) {
      if (!invalid.includes(e.name)) invalid.push(e.name);
    } else if (seen.has(e.name)) {
      if (!duplicates.includes(e.name)) duplicates.push(e.name);
    } else seen.add(e.name);
  }
  return duplicates.length || invalid.length ? { duplicates, invalid } : null;
}

/** Warning banner of the editor header (not blocking: the runtime opens the first overlay of a name). */
export function OverlayWarning({ issues }: { issues: OverlayNameIssues | null }) {
  if (!issues) return null;
  const quote = (names: string[]) => names.map((n) => `"${n}"`).join(', ');
  return (
    <div role="status" className="flex w-full items-start gap-1.5 text-xs text-warning">
      <TriangleAlertIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
      <span>
        {issues.duplicates.length ? t('pageEditor.overlays.duplicate', { names: quote(issues.duplicates) }) : null}
        {issues.duplicates.length && issues.invalid.length ? ' ' : null}
        {issues.invalid.length ? t('pageEditor.overlays.invalid', { names: quote(issues.invalid) }) : null}
      </span>
    </div>
  );
}

/** "Used by N pages" of a base page. */
export function usedByText(count: number): string {
  if (count === 0) return t('pageEditor.base.usedByNone');
  if (count === 1) return t('pageEditor.base.usedByOne');
  return t('pageEditor.base.usedBy', { count });
}

/** Confirm before publishing a base page, with the number of pages it frames (`GET …/bases/:id/usage`). */
export function BasePublishDialog({
  documentId,
  open,
  loadUsage,
  onOpenChange,
  onConfirm,
}: {
  documentId: string;
  open: boolean;
  loadUsage: (id: string) => Promise<BaseUsage>;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setCount(null);
    loadUsage(documentId).then(
      (u) => live && setCount(u.count),
      () => live && setCount(-1),
    );
    return () => {
      live = false;
    };
  }, [open, documentId, loadUsage]);
  const description =
    count === null ? t('pageEditor.base.usageLoading') : count < 0 ? t('pageEditor.base.publishNote') : `${usedByText(count)} ${count > 0 ? t('pageEditor.base.publishNote') : ''}`.trim();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('pageEditor.base.publishTitle')}
      description={description}
      confirmLabel={t('pageEditor.publish')}
      onConfirm={onConfirm}
    />
  );
}
