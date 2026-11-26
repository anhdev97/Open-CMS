// Accordion on native `<details>`/`<summary>`: works without JS, all content in the server HTML. `single` gives every
// item one shared `name` (from `useId`, unique per rendered accordion), so browsers that support exclusive details
// keep one item open; the client wrapper (`AccordionSingle`) closes siblings elsewhere. Isomorphic: no state, no browser globals.
import { Children, cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import type { NodeStyle } from '@opencloudcms/schema';
import { AccordionSingle } from '../client/AccordionSingle';
import { cn } from './tokens';
import { styleAttr, styleProps } from './style';

export const ACCORDION = 'flex flex-col';
export const ACCORDION_ITEM = 'group/acc border-b border-border';
export const ACCORDION_SUMMARY =
  'flex cursor-pointer list-none items-center justify-between gap-4 rounded-sm py-4 text-left font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&::-webkit-details-marker]:hidden';
export const ACCORDION_CHEVRON = 'size-4 shrink-0 text-muted-foreground transition-transform group-open/acc:rotate-180';
export const ACCORDION_CONTENT = 'pb-4';

export type AccordionItemProps = {
  title: string;
  children?: ReactNode;
  /** Initially open. */
  open?: boolean;
  /** Shared `name` of a `single` accordion (set by `Accordion`). */
  name?: string;
  id?: string;
  /** Builder canvas only: force the item open. Unused on the website. */
  editor?: { open?: boolean };
};

export function AccordionItem({ title, children, open, name, id, editor }: AccordionItemProps) {
  return (
    <details id={id} name={name} open={open || editor?.open ? true : undefined} className={ACCORDION_ITEM}>
      <summary className={ACCORDION_SUMMARY}>
        {title}
        <ChevronDownIcon className={ACCORDION_CHEVRON} aria-hidden="true" />
      </summary>
      <div className={ACCORDION_CONTENT}>{children}</div>
    </details>
  );
}

export type AccordionProps = {
  /** Only one item open at a time (`<details name>`). */
  single?: boolean;
  /** `'first'` opens the first item. */
  defaultOpen?: 'none' | 'first';
  /** `AccordionItem` elements. */
  children?: ReactNode;
  id?: string;
  style?: NodeStyle;
  /** Builder canvas only: force every item open. Unused on the website. */
  editor?: { open?: boolean };
};

export function Accordion({ single, defaultOpen, children, id, style, editor }: AccordionProps) {
  const name = useId();
  const sp = styleProps(style, 'flex');
  let i = 0;
  const items = Children.map(children, (child) => {
    if (!isValidElement(child)) return child;
    const first = i++ === 0;
    const p = child.props as AccordionItemProps;
    return cloneElement(child as ReactElement<AccordionItemProps>, {
      name: single ? name : p.name,
      open: p.open || (first && defaultOpen === 'first'),
      editor: editor?.open ? { open: true } : p.editor,
    });
  });
  const cls = cn(ACCORDION, sp.className);
  if (single) {
    return (
      <AccordionSingle id={id} className={cls} style={styleAttr(sp)} disabled={editor?.open === true}>
        {items}
      </AccordionSingle>
    );
  }
  return (
    <div id={id} className={cls} style={styleAttr(sp)}>
      {items}
    </div>
  );
}
