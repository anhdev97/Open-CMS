// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ActionButton,
  OverlayTrigger,
  closeAllOverlays,
  closeOverlay,
  openOverlay,
  toggleOverlay,
  useOverlay,
} from '../../blocks/src/client';

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

const html = () => document.documentElement;
const dialog = (name: string, extra = '') =>
  `<dialog data-ocms-overlay="${name}" ${extra}><div class="inner">x</div></dialog>`;

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  act(() => closeAllOverlays());
  document.body.innerHTML = '';
  html().className = '';
  vi.restoreAllMocks();
});
const d = (name: string) => document.querySelector<HTMLDialogElement>(`dialog[data-ocms-overlay="${name}"]`)!;

describe('overlay store', () => {
  it('opens a dialog and sets overflow-hidden on html', () => {
    container.innerHTML = dialog('a');
    openOverlay('a');
    expect(d('a').open).toBe(true);
    expect(html().classList.contains('overflow-hidden')).toBe(true);
  });

  it('keeps a stack: native close on the top removes only it', () => {
    container.innerHTML = dialog('a') + dialog('b');
    openOverlay('a');
    openOverlay('b');
    d('b').dispatchEvent(new Event('close'));
    expect(html().classList.contains('overflow-hidden')).toBe(true);
    d('b').removeAttribute('open');
    closeOverlay();
    expect(d('a').open).toBe(false);
    expect(html().classList.contains('overflow-hidden')).toBe(false);
  });

  it('closeOverlay() closes the top-most only', () => {
    container.innerHTML = dialog('a') + dialog('b');
    openOverlay('a');
    openOverlay('b');
    closeOverlay();
    expect(d('b').open).toBe(false);
    expect(d('a').open).toBe(true);
  });

  it('closeAllOverlays clears everything and the class', () => {
    container.innerHTML = dialog('a') + dialog('b');
    openOverlay('a');
    openOverlay('b');
    closeAllOverlays();
    expect(d('a').open || d('b').open).toBe(false);
    expect(html().classList.contains('overflow-hidden')).toBe(false);
  });

  it('toggles and is idempotent on open', () => {
    container.innerHTML = dialog('a');
    toggleOverlay('a');
    openOverlay('a');
    expect(d('a').open).toBe(true);
    toggleOverlay('a');
    expect(d('a').open).toBe(false);
  });

  it('warns once per unknown name without throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => openOverlay('nope-x')).not.toThrow();
    openOverlay('nope-x');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('returns focus to the opener', () => {
    container.innerHTML = `<button id="op">o</button>${dialog('a')}`;
    const op = container.querySelector<HTMLButtonElement>('#op')!;
    op.focus();
    openOverlay('a');
    op.blur();
    closeOverlay('a');
    expect(document.activeElement).toBe(op);
  });

  it('backdrop click closes only with data-close-on-backdrop="true"', () => {
    container.innerHTML = dialog('a', 'data-close-on-backdrop="true"') + dialog('b');
    openOverlay('a');
    openOverlay('b');
    d('b').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(d('b').open).toBe(true);
    d('a').querySelector('.inner')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(d('a').open).toBe(true);
    d('a').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(d('a').open).toBe(false);
  });
});

describe('React bindings', () => {
  it('ActionButton close inside A while B is on top closes A', () => {
    container.innerHTML = dialog('a') + dialog('b');
    const a = d('a');
    const mount = document.createElement('div');
    a.appendChild(mount);
    const r = createRoot(mount);
    act(() => r.render(createElement(ActionButton, { action: { type: 'overlay', op: 'close' }, className: 'c' }, 'Close')));
    openOverlay('a');
    openOverlay('b');
    act(() => mount.querySelector('button')!.click());
    expect(d('a').open).toBe(false);
    expect(d('b').open).toBe(true);
    act(() => r.unmount());
  });

  it('ActionButton close without a dialog closes the top; scroll scrolls', () => {
    const extra = document.createElement('div');
    extra.innerHTML = dialog('a') + '<div id="sec"></div>';
    document.body.appendChild(extra);
    const scroll = vi.fn();
    (document.getElementById('sec') as unknown as { scrollIntoView: unknown }).scrollIntoView = scroll;
    openOverlay('a');
    act(() =>
      root.render(
        createElement('div', null,
          createElement(ActionButton, { action: { type: 'scroll', target: 'sec' } }, 's'),
          createElement(ActionButton, { action: { type: 'overlay', op: 'close' } }, 'c')),
      ),
    );
    const [s, c] = [...container.querySelectorAll('button')].filter((b) => b.type === 'button').slice(-2);
    expect(s.type).toBe('button');
    act(() => s.click());
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth' });
    act(() => c.click());
    expect(d('a').open).toBe(false);
  });

  it('OverlayTrigger clones the child, calling its own onClick first', () => {
    const dlg = document.createElement('div');
    dlg.innerHTML = dialog('a');
    document.body.appendChild(dlg);
    const own = vi.fn();
    act(() => root.render(createElement(OverlayTrigger, { name: 'a' }, createElement('button', { id: 't', onClick: own }, 't'))));
    act(() => container.querySelector<HTMLButtonElement>('#t')!.click());
    expect(own).toHaveBeenCalled();
    expect(d('a').open).toBe(true);
  });

  it('useOverlay.isOpen tracks the store, including native close', () => {
    container.innerHTML = dialog('a');
    const Probe = () => {
      const o = useOverlay('a');
      return createElement('button', { id: 'p', onClick: o.toggle }, String(o.isOpen));
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const r = createRoot(host);
    act(() => r.render(createElement(Probe)));
    const p = host.querySelector('#p')!;
    expect(p.textContent).toBe('false');
    act(() => (p as HTMLButtonElement).click());
    expect(p.textContent).toBe('true');
    act(() => {
      d('a').removeAttribute('open');
      d('a').dispatchEvent(new Event('close'));
    });
    expect(p.textContent).toBe('false');
    act(() => r.unmount());
  });
});

describe('node (no DOM)', () => {
  it('require of the built CJS entry does not throw', async () => {
    const { existsSync } = await import('node:fs');
    const { createRequire } = await import('node:module');
    const path = new URL('../../dist/blocks-cjs/client/index.js', import.meta.url).pathname;
    if (!existsSync(path)) return; // covered after build
    const saved = { document: globalThis.document, window: globalThis.window };
    // @ts-expect-error simulate node
    delete globalThis.document;
    // @ts-expect-error simulate node
    delete globalThis.window;
    try {
      expect(() => createRequire(import.meta.url)(path)).not.toThrow();
    } finally {
      Object.assign(globalThis, saved);
    }
  });
});
