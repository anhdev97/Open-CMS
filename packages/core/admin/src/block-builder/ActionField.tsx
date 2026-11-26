'use client';

// Button action (spec §2): Link (no action) / Open / Close / Toggle overlay / Scroll to, and a target box with the
// known names as suggestions. Invalid targets show an inline error and are not written; a valid name that is not
// known is written with a warning (overlays are named per page). Used by the composed Button of the block builder
// and, as the page editor's custom field, by `b.action()` (library Button / ButtonGroup).
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createUsePuck, type CustomFieldRender } from '@puckeditor/core';
import type { BlockRegistry } from '@opencloudcms/core/blocks';
import { ANCHOR_ID_RE, OVERLAY_NAME_RE, type ButtonAction, type ComposedNode } from '@opencloudcms/schema';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { t } from '../i18n';
import { BlocksContext } from '../page-editor/blocks-context';
import { BaseContext, type BaseState } from '../page-editor/editor-context';
import { rootPropsToLayout } from '../page-editor/field-logic';
import { FieldShell, fieldLabel } from '../page-editor/FieldShell';
import { useBuilder } from './context';

type Choice = 'link' | 'open' | 'close' | 'toggle' | 'scroll';
const CHOICES: readonly Choice[] = ['link', 'open', 'close', 'toggle', 'scroll'];

const choiceOf = (v: ButtonAction | null | undefined): Choice => (!v ? 'link' : v.type === 'scroll' ? 'scroll' : v.op);
const targetOf = (v: ButtonAction | null | undefined): string => (v && typeof v.target === 'string' ? v.target : '');

/** The action for a choice and target text, or why it cannot be written. */
function build(choice: Choice, text: string): { action: ButtonAction | null } | { error: 'required' | 'name' | 'anchor' } {
  const target = text.trim();
  if (choice === 'link') return { action: null };
  if (choice === 'scroll') {
    if (!target) return { error: 'required' };
    return ANCHOR_ID_RE.test(target) ? { action: { type: 'scroll', target } } : { error: 'anchor' };
  }
  if (!target) return choice === 'close' ? { action: { type: 'overlay', op: 'close' } } : { error: 'required' };
  return OVERLAY_NAME_RE.test(target) ? { action: { type: 'overlay', op: choice, target } } : { error: 'name' };
}

export interface ActionEditorProps {
  id: string;
  label: string;
  value: ButtonAction | null | undefined;
  /** `null`: a plain link button. */
  onChange: (v: ButtonAction | null) => void;
  /** Overlay names on the page; `null` when they cannot be known here (the block builder). */
  overlays: readonly string[] | null;
  /** Element ids offered as scroll targets; `null` when they cannot be known here (the page editor). */
  anchors: readonly string[] | null;
  readOnly?: boolean;
}

export function ActionEditor({ id, label, value, onChange, overlays, anchors, readOnly }: ActionEditorProps) {
  const [choice, setChoice] = useState<Choice>(() => choiceOf(value));
  const [text, setText] = useState(() => targetOf(value));
  // The value last written here: a different value from outside (undo, another item) resets the editor.
  const last = useRef(JSON.stringify(value ?? null));
  useEffect(() => {
    const k = JSON.stringify(value ?? null);
    if (k === last.current) return;
    last.current = k;
    setChoice(choiceOf(value));
    setText(targetOf(value));
  }, [value]);

  const apply = (c: Choice, s: string) => {
    setChoice(c);
    setText(s);
    const r = build(c, s);
    if (!('action' in r)) return;
    const k = JSON.stringify(r.action);
    if (k === last.current) return;
    last.current = k;
    onChange(r.action);
  };

  const result = build(choice, text);
  const error = 'error' in result ? result.error : null;
  const scroll = choice === 'scroll';
  const known = (scroll ? anchors : overlays) ?? [];
  const target = text.trim();
  const listId = `${id}-targets`;
  const warning =
    !error && target && !known.includes(target) && (scroll ? anchors : overlays) !== null
      ? t(scroll ? 'blockBuilder.action.anchorNotFound' : 'blockBuilder.action.overlayNotFound', { name: target })
      : null;
  const hint =
    error === 'required'
      ? t(scroll ? 'blockBuilder.action.scrollRequired' : 'blockBuilder.action.overlayRequired')
      : !error && choice === 'close' && !target
        ? t('blockBuilder.action.closeHint')
        : !error && !scroll && overlays === null
          ? t('blockBuilder.action.perPage')
          : null;
  const errorText = error === 'name' ? t('blockBuilder.pattern.name') : error === 'anchor' ? t('blockBuilder.pattern.anchor') : null;

  return (
    <FieldShell id={id} label={label}>
      <div className="space-y-2">
        <Select value={choice} disabled={readOnly} onValueChange={(c) => apply(c as Choice, text)}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CHOICES.map((c) => (
              <SelectItem key={c} value={c}>
                {t(`blockBuilder.action.${c}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {error && (
          <p data-action-pending className="text-xs text-muted-foreground">
            {t('blockBuilder.action.pending')}
          </p>
        )}
        {choice !== 'link' && (
          <div className="space-y-1">
            <Input
              data-action-target
              aria-label={t(scroll ? 'blockBuilder.action.scrollTarget' : 'blockBuilder.action.overlayTarget')}
              placeholder={t(scroll ? 'blockBuilder.action.scrollTarget' : 'blockBuilder.action.overlayTarget')}
              list={listId}
              value={text}
              disabled={readOnly}
              aria-invalid={errorText ? true : undefined}
              aria-describedby={`${id}-msg`}
              onChange={(e) => apply(choice, e.target.value)}
            />
            <datalist id={listId}>
              {known.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <div id={`${id}-msg`}>
              {errorText && (
                <p data-action-error className="text-xs text-destructive">
                  {errorText}
                </p>
              )}
              {warning && (
                <p data-action-warning className="text-xs text-warning">
                  {warning}
                </p>
              )}
              {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
            </div>
          </div>
        )}
      </div>
    </FieldShell>
  );
}

/** `anchorId`s of `tree` that are valid scroll targets, first seen, in tree order. */
export function treeAnchorIds(tree: ComposedNode): string[] {
  const out: string[] = [];
  const walk = (n: ComposedNode) => {
    const a = n.props?.anchorId;
    if (typeof a === 'string' && ANCHOR_ID_RE.test(a) && !out.includes(a)) out.push(a);
    for (const c of n.children ?? []) walk(c);
  };
  walk(tree);
  return out;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** One overlay block placed on a page: its own `name` (`valid` when it is a valid overlay name) or the default name. */
export interface OverlayNameEntry {
  name: string;
  valid: boolean;
}

type Placement = { own: unknown; fallback: unknown };

/**
 * Overlay blocks in Puck page data or a block list, in page order: content, zones, nested slot or list props, and the
 * root `region__<name>` blocks of regions the page replaces (root prop `regionMode__<name>` = `replace`).
 */
function overlayPlacements(data: unknown, registry: Pick<BlockRegistry, 'get'>): Placement[] {
  const out: Placement[] = [];
  const visit = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(visit);
    if (!isObj(v)) return;
    if (typeof v.type === 'string' && isObj(v.props)) {
      const def = registry.get(v.type);
      if (def?.kind === 'overlay') out.push({ own: v.props.name, fallback: (def.fields as Record<string, { default?: unknown }>).name?.default });
      for (const p of Object.values(v.props)) if (Array.isArray(p)) visit(p);
      return;
    }
    // A list-field row (no `type`): its slots and nested lists.
    for (const p of Object.values(v)) if (Array.isArray(p)) visit(p);
  };
  if (Array.isArray(data)) visit(data);
  if (!isObj(data)) return out;
  visit(data.content);
  if (isObj(data.zones)) for (const z of Object.values(data.zones)) visit(z);
  const rootProps = isObj(data.root) && isObj(data.root.props) ? data.root.props : {};
  for (const [k, v] of Object.entries(rootProps)) {
    if (k.startsWith('region__') && rootProps[`regionMode__${k.slice('region__'.length)}`] === 'replace') visit(v);
  }
  return out;
}

/** Each overlay placement's own `name` (`valid: false` when it is not a valid overlay name) or, when unset, its default. */
export function overlayNameEntries(data: unknown, registry: Pick<BlockRegistry, 'get'>): OverlayNameEntry[] {
  const out: OverlayNameEntry[] = [];
  for (const { own, fallback } of overlayPlacements(data, registry)) {
    const name = typeof own === 'string' && own ? own : typeof fallback === 'string' ? fallback : '';
    if (name) out.push({ name, valid: OVERLAY_NAME_RE.test(name) });
  }
  return out;
}

/**
 * Names of the overlay blocks placed in Puck page data (see `overlayPlacements`): the item's `name` when it is a
 * valid overlay name, else the block's default name. First seen, in page order.
 */
export function overlayNamesInData(data: unknown, registry: Pick<BlockRegistry, 'get'>): string[] {
  const out: string[] = [];
  for (const { own, fallback } of overlayPlacements(data, registry)) {
    const name = typeof own === 'string' && OVERLAY_NAME_RE.test(own) ? own : typeof fallback === 'string' ? fallback : '';
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * Overlays the base page adds to this page: those in the base's regions the page shows as they are (`default`), from
 * the editor root props (base choice and region modes).
 */
export function baseOverlayEntries(base: BaseState, rootProps: Record<string, unknown> | undefined): OverlayNameEntry[] {
  if (base.status !== 'ok' || !base.frame || !base.registry) return [];
  const regions = rootPropsToLayout(rootProps ?? {})?.regions ?? {};
  const out: OverlayNameEntry[] = [];
  for (const r of base.regions) if ((regions[r] ?? 'default') === 'default') out.push(...overlayNameEntries(base.frame.props[`region__${r}`], base.registry));
  return out;
}

const asAction = (v: unknown): ButtonAction | null => (isObj(v) && (v.type === 'overlay' || v.type === 'scroll') ? (v as ButtonAction) : null);

/** Composed `Button.action` in the block builder: overlay names are per page (free text); anchors of this block. */
export const ComposedActionField: CustomFieldRender<unknown> = ({ field, name, id, value, onChange, readOnly }) => {
  const m = useBuilder();
  return (
    <ActionEditor
      id={id}
      label={fieldLabel(field, name)}
      value={asAction(value)}
      onChange={(v) => onChange(v ?? undefined)}
      overlays={null}
      anchors={m.anchors}
      readOnly={readOnly || m.readOnly}
    />
  );
};

const usePuck = createUsePuck();
const NO_BLOCKS: Pick<BlockRegistry, 'get'> = { get: () => undefined };

/** `b.action()` in the page editor (`null` = link): the overlays placed on this page and on its base page are suggested. */
export const PageActionField: CustomFieldRender<ButtonAction | null> = ({ field, name, id, value, onChange, readOnly }) => {
  const registry = useContext(BlocksContext) ?? NO_BLOCKS;
  const base = useContext(BaseContext);
  const data = usePuck((s) => s.appState.data);
  const overlays = useMemo(() => {
    const own = overlayNamesInData(data, registry);
    const fromBase = baseOverlayEntries(base, data.root?.props as Record<string, unknown> | undefined)
      .filter((e) => e.valid)
      .map((e) => e.name);
    return [...new Set([...own, ...fromBase])];
  }, [data, registry, base]);
  return (
    <ActionEditor id={id} label={fieldLabel(field, name)} value={asAction(value)} onChange={onChange} overlays={overlays} anchors={null} readOnly={readOnly} />
  );
};
