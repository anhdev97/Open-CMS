'use client';

// "Add item" / "Add tab" of Accordion and Tabs (spec §3): AccordionItem and TabPanel are not in the palette; this
// field of the parent appends one (`Item n` / `Tab n`) and selects it. They are reordered by dragging in the canvas
// or the outline. Relative imports only (root vitest).
import { PlusIcon } from 'lucide-react';
import { useContext } from 'react';
import { createUsePuck, useGetPuck, type CustomFieldRender } from '@puckeditor/core';
import { Button } from '../components/ui/button';
import { t } from '../i18n';
import { FieldShell, fieldLabel } from '../page-editor/FieldShell';
import { BuilderContext } from './context';
import { childItemBind } from './element-config';
import type { PuckItem } from './tree-puck';

type ItemEl = 'AccordionItem' | 'TabPanel';

/** The item added after `count` existing ones (1-based numbering in its bound text). */
export function newChildItem(el: ItemEl, count: number, id: string): PuckItem {
  return { type: el, props: { id, bind: childItemBind(el, count + 1) } };
}

const newId = (el: string) => `${el}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
const usePuck = createUsePuck();

/** Puck custom field `childItems` of Accordion / Tabs (`metadata.item`). */
export const ChildItemsField: CustomFieldRender<unknown> = ({ field, name, id, readOnly }) => {
  const item = ((field.metadata ?? {}) as { item?: ItemEl }).item ?? 'TabPanel';
  const builderReadOnly = useContext(BuilderContext)?.readOnly ?? false;
  const getPuck = useGetPuck();
  const count = usePuck((s) => {
    const kids = (s.selectedItem?.props as Record<string, unknown> | undefined)?.children;
    return Array.isArray(kids) ? kids.length : 0;
  });

  const add = () => {
    const api = getPuck();
    const sel = api.selectedItem as unknown as PuckItem | null;
    const at = sel ? api.getSelectorForId(String(sel.props.id)) : undefined;
    if (!sel || !at) return;
    const kids = Array.isArray(sel.props.children) ? (sel.props.children as PuckItem[]) : [];
    const next = newChildItem(item, kids.length, newId(item));
    api.dispatch({ type: 'replace', destinationIndex: at.index, destinationZone: at.zone, data: { ...sel, props: { ...sel.props, children: [...kids, next] } } as never });
    // Select the new item so the canvas shows it (a new tab becomes the shown one).
    const added = api.getSelectorForId(next.props.id);
    if (added) api.dispatch({ type: 'setUi', ui: { itemSelector: added } });
  };

  return (
    <FieldShell id={id} as="legend" label={fieldLabel(field, name)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{t(`blockBuilder.childItems.${item}.count`, { count })}</span>
        <Button type="button" size="sm" variant="outline" disabled={readOnly || builderReadOnly} onClick={add}>
          <PlusIcon aria-hidden="true" />
          {t(`blockBuilder.childItems.${item}.add`)}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('blockBuilder.childItems.hint')}</p>
    </FieldShell>
  );
};
