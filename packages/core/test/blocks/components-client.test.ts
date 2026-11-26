// @vitest-environment happy-dom
import { act, createElement as h, type ReactElement } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { foldSearch } from '@opencloudcms/schema';
import { Carousel, Combobox, Dropdown, Tabs, closeAllDropdowns, closeAllOverlays, filterOptions, openOverlay, closeOverlay } from '../../blocks/src/client';
import { Accordion, AccordionItem, Tooltip } from '../../blocks/src/ui';
import { clampShift } from '../../blocks/src/client/TooltipBubble';
import { defineComposedBlock, type ComposedBlockSpec } from '../../blocks/src';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
proto.showModal = function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
proto.close = function (this: HTMLDialogElement) {
  if (!this.hasAttribute('open')) return;
  this.removeAttribute('open');
  this.dispatchEvent(new Event('close'));
};

let container: HTMLElement;
let root: Root | undefined;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  act(() => closeAllOverlays());
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Server HTML into the container, then hydrate it (as the website does). Returns the server HTML. */
function mount(node: ReactElement, wrap?: (html: string) => string): string {
  const html = renderToString(node);
  container.innerHTML = wrap ? wrap(html) : html;
  const host = wrap ? (container.querySelector('[data-host]') as HTMLElement) : container;
  act(() => {
    root = hydrateRoot(host, node, { onRecoverableError: (e) => { throw e; } });
  });
  return html;
}

const $ = <T extends Element = HTMLElement>(sel: string) => container.querySelector<T>(sel)!;
const $$ = <T extends Element = HTMLElement>(sel: string) => [...container.querySelectorAll<T>(sel)];
const pointer = (type: string, el: Element, pointerType: string, init: PointerEventInit = {}) =>
  act(() => {
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType, ...init }));
  });
const key = (el: Element, k: string) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });
const click = (el: HTMLElement) => act(() => el.click());

// ---- Dropdown

const menu = (extra: Record<string, unknown> = {}) =>
  h(Dropdown, { label: 'Products', ...extra }, h('a', { href: '/a' }, 'Shirts'), h('a', { href: '/b' }, 'Totes'));

describe('Dropdown', () => {
  const panel = () => $('[role="group"]');
  const toggle = () => $<HTMLButtonElement>('button[aria-expanded]');

  it('server HTML: panel content, collapsed toggle with aria-controls, CSS hover/focus opening before hydration', () => {
    const html = renderToString(menu());
    expect(html).toContain('Shirts');
    expect(html).toContain('Totes');
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*aria-controls="[^"]+-panel"/);
    expect(html).toContain('role="group"');
    expect(html).toContain('group-hover/dropdown:block');
    expect(html).toContain('group-focus-within/dropdown:block');
    expect(html.match(/role="group"/g)).toHaveLength(1);
  });

  it('mouse hover opens and leaving closes; once hydrated the CSS hover classes are gone (no sticky hover)', () => {
    vi.useFakeTimers();
    mount(menu());
    expect(panel().className).not.toContain('group-hover');
    pointer('pointerover', toggle(), 'mouse');
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(panel().className.split(' ')).toContain('block');
    pointer('pointerout', toggle(), 'mouse', { relatedTarget: document.body });
    act(() => vi.advanceTimersByTime(200));
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(panel().className.split(' ')).toContain('hidden');
  });

  it('touch: a tap (pointerdown + click) opens, a second tap closes, a tap outside closes; hover is ignored', () => {
    mount(menu());
    const tap = (el: HTMLElement) => {
      pointer('pointerdown', el, 'touch');
      click(el);
    };
    pointer('pointerover', toggle(), 'touch');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    pointer('pointerdown', toggle(), 'touch');
    expect(toggle().getAttribute('aria-expanded')).toBe('false'); // nothing until the click
    click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    tap(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    tap(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    pointer('pointerdown', document.body, 'touch');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('touch: a press that becomes a scroll (pointerdown + pointercancel, no click) does not toggle', () => {
    mount(menu({ display: 'inline' }));
    pointer('pointerdown', toggle(), 'touch');
    pointer('pointercancel', toggle(), 'touch');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    // Open, then a scroll over the trigger leaves it open.
    pointer('pointerdown', toggle(), 'touch');
    click(toggle());
    pointer('pointerdown', toggle(), 'touch');
    pointer('pointercancel', toggle(), 'touch');
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
  });

  it('touch: a tap on a hover-capable dropdown toggles plainly (no hover pinning)', () => {
    mount(menu());
    pointer('pointerdown', toggle(), 'touch');
    click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    pointer('pointerdown', toggle(), 'pen');
    click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('mouse: a click on a hover-opened panel pins it; the next click closes', () => {
    vi.useFakeTimers();
    mount(menu());
    pointer('pointerover', toggle(), 'mouse');
    pointer('pointerdown', toggle(), 'mouse');
    click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    pointer('pointerout', toggle(), 'mouse', { relatedTarget: document.body });
    act(() => vi.advanceTimersByTime(200));
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    pointer('pointerdown', toggle(), 'mouse');
    click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('keyboard: click toggles, ArrowDown focuses the first item, arrows move, Esc closes and returns focus to the trigger', () => {
    mount(menu({ openOn: 'click' }));
    toggle().focus();
    key(toggle(), 'ArrowDown');
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement?.textContent).toBe('Shirts');
    key(document.activeElement!, 'ArrowDown');
    expect(document.activeElement?.textContent).toBe('Totes');
    key(document.activeElement!, 'Escape');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle());
    click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('openOn click: hover does not open', () => {
    mount(menu({ openOn: 'click' }));
    pointer('pointerover', toggle(), 'mouse');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('with href the label is a link and only the chevron button toggles', () => {
    const html = mount(menu({ href: '/products' }));
    expect(html).toMatch(/<a[^>]*href="\/products"[^>]*>Products<\/a>/);
    const link = $<HTMLAnchorElement>('a[href="/products"]');
    expect(link.hasAttribute('aria-expanded')).toBe(false);
    expect($$('button[aria-expanded]')).toHaveLength(1);
    expect(toggle().getAttribute('aria-label')).toBe('Show submenu: Products');
    expect(toggle().querySelector('svg')).not.toBeNull();
    click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
  });

  it('a link click in the panel, closeAllDropdowns (route change) and the containing overlay closing close it', () => {
    mount(h('dialog', { 'data-ocms-overlay': 'nav' }, menu({ openOn: 'click' })));
    act(() => openOverlay('nav'));
    click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    act(() => {
      $<HTMLAnchorElement>('a[href="/a"]').addEventListener('click', (e) => e.preventDefault());
    });
    click($('a[href="/a"]'));
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    click(toggle());
    act(() => closeAllDropdowns());
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    click(toggle());
    act(() => closeOverlay('nav'));
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('responsive display: one panel, inline (in the flow) on mobile and popover from md; bottom-end is capped to the viewport', () => {
    const html = renderToString(menu({ display: { base: 'inline', md: 'popover' }, placement: 'bottom-end' }));
    expect(html.match(/role="group"/g)).toHaveLength(1);
    const cls = /role="group"[^>]*class="([^"]+)"/.exec(html)?.[1] ?? /class="([^"]+)"[^>]*role="group"/.exec(html)![1];
    const c = cls.split(' ');
    expect(c).toContain('static');
    expect(c).toContain('md:absolute');
    expect(c).toContain('md:right-0');
    expect(c).not.toContain('right-0');
    expect(c).toContain('md:max-w-[calc(100vw-2rem)]');
    expect(c).toContain('md:group-hover/dropdown:block');
    expect(c).not.toContain('group-hover/dropdown:block');
  });

  it('inline display: hover does not open, the toggle does', () => {
    mount(menu({ display: 'inline' }));
    pointer('pointerover', toggle(), 'mouse');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
  });

  it('an open popover panel past the right edge is shifted into the viewport (8 px); closing clears the shift', () => {
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 375 });
    try {
      mount(menu({ openOn: 'click' }));
      vi.spyOn(panel(), 'getBoundingClientRect').mockReturnValue({ left: 254, right: 446, width: 192, height: 80, top: 40, bottom: 120, x: 254, y: 40, toJSON: () => ({}) } as DOMRect);
      pointer('pointerdown', toggle(), 'touch');
      click(toggle());
      expect(toggle().getAttribute('aria-expanded')).toBe('true');
      expect(panel().style.transform).toBe('translateX(-79px)');
      pointer('pointerdown', toggle(), 'touch');
      click(toggle());
      expect(panel().style.transform).toBe('');
    } finally {
      delete (document.documentElement as unknown as Record<string, unknown>).clientWidth;
    }
  });

  it('an inline panel is never shifted', () => {
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 375 });
    try {
      mount(menu({ display: 'inline' }));
      vi.spyOn(panel(), 'getBoundingClientRect').mockReturnValue({ left: 254, right: 446, width: 192, height: 80, top: 40, bottom: 120, x: 254, y: 40, toJSON: () => ({}) } as DOMRect);
      click(toggle());
      expect(toggle().getAttribute('aria-expanded')).toBe('true');
      expect(panel().style.transform).toBe('');
    } finally {
      delete (document.documentElement as unknown as Record<string, unknown>).clientWidth;
    }
  });

  it('editor.open forces the panel open', () => {
    const html = renderToString(menu({ editor: { open: true } }));
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toContain('group-hover/dropdown:block');
  });
});

// ---- Tabs

const panels = [
  { label: 'One', content: h('p', null, 'First') },
  { label: 'Two', content: h('p', null, 'Second') },
  { label: 'Three', content: h('p', null, 'Third') },
];

describe('Tabs', () => {
  it('server HTML has every panel, all but the first hidden; ArrowRight selects tab 2', () => {
    const html = mount(h(Tabs, { panels }));
    expect(html).toContain('role="tablist"');
    expect(html).toContain('First');
    expect(html).toContain('Second');
    expect(html).toContain('Third');
    const ps = $$('[role="tabpanel"]');
    expect(ps.map((p) => p.hasAttribute('hidden'))).toEqual([false, true, true]);
    const tabs = $$<HTMLButtonElement>('[role="tab"]');
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    expect(tabs[1].getAttribute('aria-controls')).toBe(ps[1].id);
    expect(ps[1].getAttribute('aria-labelledby')).toBe(tabs[1].id);
    tabs[0].focus();
    key(tabs[0], 'ArrowRight');
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    expect(ps.map((p) => p.hasAttribute('hidden'))).toEqual([true, false, true]);
    expect(document.activeElement).toBe(tabs[1]);
    key(tabs[1], 'End');
    expect(document.activeElement).toBe(tabs[2]);
    key(tabs[2], 'ArrowRight');
    expect(document.activeElement).toBe(tabs[0]);
    key(tabs[0], 'ArrowLeft');
    expect(document.activeElement).toBe(tabs[2]);
    key(tabs[2], 'Home');
    expect(document.activeElement).toBe(tabs[0]);
    click(tabs[1]);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
  });

  it('editor.activeIndex controls the shown tab and onSelect reports a click', () => {
    const onSelect = vi.fn();
    mount(h(Tabs, { panels, editor: { activeIndex: 2, onSelect } }));
    expect($$('[role="tabpanel"]').map((p) => p.hasAttribute('hidden'))).toEqual([true, true, false]);
    click($$<HTMLButtonElement>('[role="tab"]')[0]);
    expect(onSelect).toHaveBeenCalledWith(0);
    expect($$('[role="tabpanel"]').map((p) => p.hasAttribute('hidden'))).toEqual([true, true, false]);
  });
});

// ---- Carousel

const slides = (n: number) => Array.from({ length: n }, (_, i) => h('div', { key: i }, `Slide ${i + 1}`));
const current = () => $$('[aria-current]').findIndex((d) => d.getAttribute('aria-current') === 'true');

function reducedMotion(on: boolean) {
  const real = window.matchMedia.bind(window);
  vi.spyOn(window, 'matchMedia').mockImplementation((q: string) =>
    q.includes('prefers-reduced-motion')
      ? ({ matches: on, media: q, addEventListener: () => {}, removeEventListener: () => {} } as unknown as MediaQueryList)
      : real(q),
  );
}

describe('Carousel', () => {
  it('server HTML: carousel section, scroll-snap track, every slide labelled "n of N", no controls before hydration', () => {
    const html = renderToString(h(Carousel, { label: 'Strip', autoplay: 5 }, ...slides(3)));
    expect(html).toContain('aria-roledescription="carousel"');
    expect(html).toContain('aria-label="Strip"');
    expect(html).toContain('snap-x');
    expect(html).toContain('overflow-x-auto');
    expect(html.match(/role="group"/g)).toHaveLength(3);
    expect(html).toContain('aria-label="2 of 3"');
    expect(html).not.toContain('<button');
  });

  it('1 slide, or slides <= perView (also with loop): no arrows, no dots, no timer', () => {
    vi.useFakeTimers();
    mount(h(Carousel, { autoplay: 3, loop: true }, ...slides(1)));
    expect($$('button')).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    act(() => root!.unmount());
    root = undefined;
    container.innerHTML = '';
    mount(h(Carousel, { autoplay: 3, loop: true, perView: { base: 3 } }, ...slides(3)));
    expect($$('button')).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(30000));
    expect($$('button')).toHaveLength(0);
  });

  it('more slides than in view: arrows and one dot per position after hydration; next/prev move', () => {
    mount(h(Carousel, { perView: 2 }, ...slides(4)));
    expect($$('button[aria-label="Previous slide"]')).toHaveLength(1);
    expect($$('button[aria-label^="Go to slide"]')).toHaveLength(3);
    expect(current()).toBe(0);
    expect($<HTMLButtonElement>('button[aria-label="Previous slide"]').disabled).toBe(true);
    click($('button[aria-label="Next slide"]'));
    expect(current()).toBe(1);
    click($('button[aria-label="Go to slide 3"]'));
    expect(current()).toBe(2);
    expect($<HTMLButtonElement>('button[aria-label="Next slide"]').disabled).toBe(true);
  });

  it('autoplay 5 advances after 5 s, pauses while focus is inside and with the pause button', () => {
    vi.useFakeTimers();
    mount(h(Carousel, { autoplay: 5 }, ...slides(3)));
    expect(current()).toBe(0);
    act(() => vi.advanceTimersByTime(4900));
    expect(current()).toBe(0);
    act(() => vi.advanceTimersByTime(200));
    expect(current()).toBe(1);
    act(() => $('button[aria-label="Next slide"]').focus());
    act(() => vi.advanceTimersByTime(20000));
    expect(current()).toBe(1);
    act(() => (document.activeElement as HTMLElement).blur());
    act(() => vi.advanceTimersByTime(5000));
    expect(current()).toBe(2);
    act(() => vi.advanceTimersByTime(5000));
    expect(current()).toBe(0); // wraps
    // Pause button (clicked by mouse: focus is then moved away).
    click($('button[aria-label="Pause"]'));
    act(() => (document.activeElement as HTMLElement).blur());
    act(() => vi.advanceTimersByTime(20000));
    expect(current()).toBe(0);
    expect($$('button[aria-label="Play"]')).toHaveLength(1);
  });

  it('autoplay pauses on mouse hover and while the page is hidden', () => {
    vi.useFakeTimers();
    mount(h(Carousel, { autoplay: 3 }, ...slides(3)));
    pointer('pointerover', $('section'), 'mouse');
    act(() => vi.advanceTimersByTime(10000));
    expect(current()).toBe(0);
    pointer('pointerout', $('section'), 'mouse', { relatedTarget: document.body });
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    act(() => vi.advanceTimersByTime(10000));
    expect(current()).toBe(0);
    hidden.mockReturnValue(false);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    act(() => vi.advanceTimersByTime(3000));
    expect(current()).toBe(1);
  });

  it('no autoplay under prefers-reduced-motion: reduce', () => {
    vi.useFakeTimers();
    reducedMotion(true);
    mount(h(Carousel, { autoplay: 5 }, ...slides(3)));
    act(() => vi.advanceTimersByTime(30000));
    expect(current()).toBe(0);
    expect($$('button[aria-label="Pause"]')).toHaveLength(0);
  });

  it('editor.static: no autoplay, no controls, no snapping', () => {
    vi.useFakeTimers();
    mount(h(Carousel, { autoplay: 5, editor: { static: true } }, ...slides(3)));
    expect($$('button')).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    expect($('[data-ocms-carousel-track]').className).not.toContain('snap-x');
  });

  it('per-view variables per breakpoint and the gap', () => {
    const html = renderToString(h(Carousel, { perView: { base: 1, lg: 4 }, gap: '6' }, ...slides(5)));
    expect(html).toContain('--ocms-pv:1;--ocms-pv-md:1;--ocms-pv-lg:4');
    expect(html).toContain('--ocms-gap:calc(var(--spacing) * 6)');
  });
});

// ---- Combobox

const topics = [
  { value: 'dv', label: 'Dịch vụ' },
  { value: 'sp', label: 'Sản phẩm' },
  { value: 'dh', label: 'Đơn hàng' },
];

function type(el: HTMLInputElement, text: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('Combobox', () => {
  it('server HTML is a native <select name=topic> with the options', () => {
    const html = renderToString(h(Combobox, { name: 'topic', options: topics, label: 'Topic' }));
    expect(html).toMatch(/<select[^>]*name="topic"/);
    expect(html).toContain('<option value="dv">Dịch vụ</option>');
    expect(html).not.toContain('role="combobox"');
  });

  it('after hydration: combobox + listbox, accent-insensitive matching ("dich" → "Dịch vụ"), the hidden input keeps the name', () => {
    mount(h(Combobox, { name: 'topic', options: topics, label: 'Topic', help: 'Pick one' }));
    expect($$('select')).toHaveLength(0);
    const input = $<HTMLInputElement>('input[role="combobox"]');
    const hidden = $<HTMLInputElement>('input[type="hidden"]');
    expect(hidden.name).toBe('topic');
    expect(hidden.value).toBe('');
    expect(input.getAttribute('aria-controls')).toBe($('[role="listbox"]').id);
    expect($<HTMLLabelElement>('label').htmlFor).toBe(input.id);
    expect(input.getAttribute('aria-describedby')).toBe($('p').id);
    input.focus();
    type(input, 'dich');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    const opts = $$('[role="option"]');
    expect(opts.map((o) => o.textContent)).toEqual(['Dịch vụ']);
    expect(input.getAttribute('aria-activedescendant')).toBe(opts[0].id);
    key(input, 'Enter');
    expect(hidden.value).toBe('dv');
    expect(input.value).toBe('Dịch vụ');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    // "DON" matches "Đơn hàng" (đ → d).
    type(input, 'DON');
    expect($$('[role="option"]').map((o) => o.textContent)).toEqual(['Đơn hàng']);
    key(input, 'Escape');
    expect(input.value).toBe('Dịch vụ');
    expect(hidden.value).toBe('dv');
  });

  it('arrow keys and a click choose; no match shows a message', () => {
    mount(h(Combobox, { name: 'topic', options: topics, defaultValue: 'sp' }));
    const input = $<HTMLInputElement>('input[role="combobox"]');
    expect(input.value).toBe('Sản phẩm');
    input.focus();
    key(input, 'ArrowDown');
    expect($$('[role="option"]')).toHaveLength(3);
    key(input, 'ArrowDown');
    key(input, 'Enter');
    expect($<HTMLInputElement>('input[type="hidden"]').value).toBe('dh');
    type(input, 'zzz');
    expect($('[role="listbox"]').textContent).toBe('No matches');
    type(input, 'san');
    click($('[role="option"]'));
    expect($<HTMLInputElement>('input[type="hidden"]').value).toBe('sp');
  });

  it('keeps a choice made in the native select before hydration', () => {
    const node = h(Combobox, { name: 'topic', options: topics });
    container.innerHTML = renderToString(node);
    $<HTMLSelectElement>('select').value = 'dh';
    act(() => {
      root = hydrateRoot(container, node);
    });
    expect($<HTMLInputElement>('input[type="hidden"]').value).toBe('dh');
    expect($<HTMLInputElement>('input[role="combobox"]').value).toBe('Đơn hàng');
  });

  it('filterOptions uses foldSearch', () => {
    expect(filterOptions(topics, 'HANG').map((o) => o.value)).toEqual(['dh']);
    expect(filterOptions(topics, '  ')).toHaveLength(3);
    expect(foldSearch('Đơn')).toBe('don');
  });
});

// ---- Accordion single

describe('Accordion single', () => {
  it('opening item 2 closes item 1 (client), several may stay open without single', async () => {
    mount(h(Accordion, { single: true, defaultOpen: 'first' }, h(AccordionItem, { title: 'A' }, 'a'), h(AccordionItem, { title: 'B' }, 'b')));
    const [a, b] = $$<HTMLDetailsElement>('details');
    expect(a.open).toBe(true);
    expect($('[data-ocms-accordion="single"]')).not.toBeNull();
    b.open = true;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(b.open).toBe(true);
    expect(a.open).toBe(false);
  });

  it('without single, items open independently', async () => {
    mount(h(Accordion, {}, h(AccordionItem, { title: 'A', open: true }, 'a'), h(AccordionItem, { title: 'B' }, 'b')));
    const [a, b] = $$<HTMLDetailsElement>('details');
    b.open = true;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(a.open && b.open).toBe(true);
  });
});

// ---- Tooltip bubble (client)

describe('Tooltip bubble', () => {
  const tip = () =>
    h(Tooltip, { text: 'Free delivery', side: 'top', children: (tid: string) => h('button', { type: 'button', 'aria-describedby': tid }, 'Badge') });
  const bubble = () => $('[role="tooltip"]');
  const rect = (left: number, width: number) =>
    vi.spyOn(bubble(), 'getBoundingClientRect').mockReturnValue({ left, right: left + width, width, height: 20, top: 0, bottom: 20, x: left, y: 0, toJSON: () => ({}) } as DOMRect);
  beforeEach(() => {
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 375 });
  });
  afterEach(() => {
    delete (document.documentElement as unknown as Record<string, unknown>).clientWidth;
  });

  it('server HTML is unchanged: one <span role="tooltip"> with the bubble classes and the text, no inline style', () => {
    const html = mount(tip());
    expect(html).toMatch(/<span role="tooltip" id="[^"]+" class="[^"]*group-hover\/tooltip:block[^"]*">Free delivery<\/span>/);
    expect(html).not.toContain('style=');
  });

  it('clampShift keeps 8 px from both edges; the left edge wins when the bubble is wider than the viewport', () => {
    expect(clampShift(150, 470, 375)).toBe(-103);
    expect(clampShift(100, 200, 375)).toBe(0);
    expect(clampShift(-40, 100, 375)).toBe(48);
    expect(clampShift(-40, 500, 375)).toBe(48);
  });

  it('pointerenter and focusin move an overflowing bubble into the viewport with translateX; a fitting one gets none', () => {
    mount(tip());
    const wrap = $('.group\\/tooltip');
    rect(150, 320);
    pointer('pointerenter', wrap, 'mouse');
    expect(bubble().style.transform).toBe('translateX(-103px)');
    rect(100, 100);
    act(() => $('button').focus());
    expect(bubble().style.transform).toBe('');
  });

  it('Esc hides a shown bubble until the pointer has left and focus has left', () => {
    mount(h('div', null, tip(), h('button', { id: 'out' }, 'out')));
    const wrap = $('.group\\/tooltip');
    rect(100, 100);
    // Not shown: Esc does nothing.
    key(document.body, 'Escape');
    expect(bubble().style.display).toBe('');
    pointer('pointerenter', wrap, 'mouse');
    act(() => $('button').focus());
    key(document.body, 'Escape');
    expect(bubble().style.display).toBe('none');
    pointer('pointerleave', wrap, 'mouse');
    expect(bubble().style.display).toBe('none'); // still focused
    pointer('pointerenter', wrap, 'mouse');
    act(() => $<HTMLButtonElement>('#out').focus());
    expect(bubble().style.display).toBe('none'); // still hovered
    pointer('pointerleave', wrap, 'mouse');
    expect(bubble().style.display).toBe('');
  });

  it('editor.open (forced): Esc does not hide it', () => {
    mount(h(Tooltip, { text: 'x', editor: { open: true }, children: h('span', null, 't') }));
    act(() => $('.group\\/tooltip').focus());
    key(document.body, 'Escape');
    expect(bubble().style.display).toBe('');
  });
});

// ---- Through the composed renderer

const spec = (tree: ComposedBlockSpec['tree'], over: Partial<ComposedBlockSpec> = {}): ComposedBlockSpec => ({
  id: 'blk_cc0001',
  name: 'Comp',
  label: { 'en-US': 'Components' },
  category: 'content',
  version: 1,
  fields: {},
  tree,
  ...over,
});

describe('composed renderer', () => {
  it('Dropdown, Tabs, Carousel and Combobox render from a spec', () => {
    const def = defineComposedBlock(
      spec({
        el: 'Stack',
        children: [
          {
            el: 'Dropdown',
            bind: { label: { from: 'const', value: 'Menu' }, href: { from: 'const', value: '/menu' } },
            children: [{ el: 'Button', bind: { label: { from: 'const', value: 'Item' }, href: { from: 'const', value: '/i' } } }],
          },
          {
            el: 'Tabs',
            children: [
              { el: 'TabPanel', bind: { label: { from: 'const', value: 'T1' } }, children: [{ el: 'Text', bind: { text: { from: 'const', value: 'P1' } } }] },
              { el: 'TabPanel', bind: { label: { from: 'const', value: 'T2' } }, children: [{ el: 'Text', bind: { text: { from: 'const', value: 'P2' } } }] },
            ],
          },
          { el: 'Carousel', props: { perView: { base: 1, md: 2 }, autoplay: 5 }, children: [{ el: 'Divider' }, { el: 'Divider' }, { el: 'Divider' }] },
          { el: 'Combobox', props: { name: 'topic', options: topics }, bind: { label: { from: 'const', value: 'Topic' } } },
        ],
      }),
    );
    const html = renderToString(def.render({} as never) as never);
    expect(html).toMatch(/<a[^>]*href="\/menu"[^>]*>Menu<\/a>/);
    expect(html).toContain('href="/i"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('P1');
    expect(html).toContain('P2');
    expect(html.match(/role="tabpanel"[^>]*hidden=""/g)).toHaveLength(1);
    expect(html).toContain('aria-roledescription="carousel"');
    expect(html).toContain('aria-label="Components"');
    expect(html).toContain('aria-label="3 of 3"');
    expect(html).toMatch(/<select[^>]*name="topic"/);
  });

  it('Tabs in two collection items have distinct ids', () => {
    const def = defineComposedBlock(
      spec(
        {
          el: 'Card',
          children: [
            {
              el: 'Tabs',
              children: [
                { el: 'TabPanel', bind: { label: { from: 'entry', path: 'name' } } },
                { el: 'TabPanel', bind: { label: { from: 'const', value: 'More' } } },
              ],
            },
          ],
        },
        { binding: { apiId: 'product', mode: 'collection', layout: { kind: 'grid', columns: 2 } } },
      ),
    );
    const html = renderToString(def.render({ entries: [{ documentId: 'a', name: 'A' }, { documentId: 'b', name: 'B' }] } as never) as never);
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(8);
    expect(new Set(ids).size).toBe(8);
  });
});

// ---- Every literal class of the client runtimes is a real Tailwind utility (compiled with the repo's Tailwind + theme).

describe('client runtime classes compile', () => {
  it('each class of the lookup tables produces CSS', async () => {
    const { readFileSync } = await import('node:fs');
    const { createRequire } = await import('node:module');
    const { dirname, resolve } = await import('node:path');
    const { compile } = await import('tailwindcss');
    const here = resolve(__dirname);
    const req = createRequire(resolve(here, '../../package.json'));
    const THEME = resolve(here, '../../admin/src/styles/theme.css');
    const tw = await compile(`@import "tailwindcss";\n@import "${THEME}";`, {
      base: here,
      loadStylesheet: async (id: string, base: string) => {
        const pkg = (name: string) => {
          const dir = resolve(here, '../../node_modules', name);
          return resolve(dir, JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8')).main);
        };
        const path = id === 'tailwindcss' ? req.resolve('tailwindcss/index.css') : id.startsWith('/') || id.startsWith('.') ? resolve(base, id) : pkg(id);
        return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
      },
    });
    const mods = await Promise.all([
      import('../../blocks/src/client/Dropdown'),
      import('../../blocks/src/client/Tabs'),
      import('../../blocks/src/client/Carousel'),
      import('../../blocks/src/client/Combobox'),
      import('../../blocks/src/ui/tooltip'),
      import('../../blocks/src/ui/accordion'),
    ]);
    const strings: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === 'string') strings.push(v);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    for (const m of mods) for (const [k, v] of Object.entries(m)) if (/^[A-Z_]+$/.test(k) && k !== 'CAROUSEL_GAP') walk(v);
    const classes = [...new Set(strings.flatMap((s) => s.split(/\s+/)).filter((c) => c && !/^group\/\w+$/.test(c)))]; // `group/x` markers emit no CSS
    expect(classes.length).toBeGreaterThan(100);
    const bad: string[] = [];
    let size = tw.build([]).length;
    for (const c of classes) {
      const next = tw.build([c]).length;
      if (next <= size) bad.push(c);
      size = next;
    }
    expect(bad).toEqual([]);
    const css = tw.build([]);
    expect(css).toContain('.group\\/acc');
    expect(css).toContain('.group\\/tooltip');
    expect(css).toContain('flex-basis: calc((100% - (var(--ocms-pv) - 1) * var(--ocms-gap)) / var(--ocms-pv))');
  });
});
