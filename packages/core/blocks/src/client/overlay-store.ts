'use client';

const stack: HTMLDialogElement[] = [];
const openers = new WeakMap<HTMLDialogElement, HTMLElement | null>();
const wired = new WeakSet<HTMLDialogElement>();
const listeners = new Set<() => void>();
const warned = new Set<string>();

const emit = () => listeners.forEach((l) => l());
const syncPage = () => {
  document.documentElement.classList.toggle('overflow-hidden', stack.length > 0);
};

export function subscribeOverlays(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Drop dialogs removed from the DOM (route change): no `close` event fires for them. */
function prune(notify: boolean): void {
  let changed = false;
  for (let i = stack.length - 1; i >= 0; i--) {
    if (!stack[i].isConnected) {
      openers.delete(stack[i]);
      stack.splice(i, 1);
      changed = true;
    }
  }
  if (!changed) return;
  syncPage();
  if (notify) emit();
}

export function isOverlayOpen(name: string): boolean {
  prune(false);
  return stack.some((d) => d.getAttribute('data-ocms-overlay') === name);
}

function find(name: string): HTMLDialogElement | null {
  const el =
    [...document.querySelectorAll<HTMLDialogElement>('dialog[data-ocms-overlay]')].find(
      (d) => d.getAttribute('data-ocms-overlay') === name,
    ) ?? null;
  if (!el && !warned.has(name)) {
    warned.add(name);
    console.warn(`[opencms] overlay "${name}" not found on this page`);
  }
  return el;
}

function release(dialog: HTMLDialogElement): void {
  const i = stack.indexOf(dialog);
  if (i === -1) return;
  stack.splice(i, 1);
  const opener = openers.get(dialog);
  openers.delete(dialog);
  syncPage();
  if (opener && opener.isConnected) opener.focus();
  emit();
}

function wire(dialog: HTMLDialogElement): void {
  if (wired.has(dialog)) return;
  wired.add(dialog);
  dialog.addEventListener('close', () => {
    // The native event is queued: a stale one must not release a dialog that was re-opened meanwhile.
    if (dialog.open) return;
    release(dialog);
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog && dialog.getAttribute('data-close-on-backdrop') === 'true') dialog.close();
  });
}

// Note: open/toggle without a target (ActionButton) is a no-op; only close falls back to the containing/top overlay.
export function openOverlay(name: string): void {
  if (typeof document === 'undefined') return;
  prune(true);
  const dialog = find(name);
  if (!dialog || stack.includes(dialog)) return;
  wire(dialog);
  const active = document.activeElement;
  openers.set(dialog, active instanceof HTMLElement && active !== document.body ? active : null);
  if (!dialog.open) dialog.showModal();
  stack.push(dialog);
  syncPage();
  emit();
}

export function closeOverlay(name?: string): void {
  if (typeof document === 'undefined') return;
  prune(true);
  const dialog = name === undefined ? stack[stack.length - 1] : stack.find((d) => d.getAttribute('data-ocms-overlay') === name);
  if (!dialog) {
    if (name !== undefined) find(name);
    return;
  }
  dialog.close();
  release(dialog);
}

export function toggleOverlay(name: string): void {
  if (typeof document !== 'undefined') prune(true);
  if (isOverlayOpen(name)) closeOverlay(name);
  else openOverlay(name);
}

export function closeAllOverlays(): void {
  if (typeof document === 'undefined') return;
  prune(true);
  for (const d of [...stack].reverse()) {
    d.close();
    release(d);
  }
}
