export type Theme = 'light' | 'dark' | 'system';

const KEY = 'opencms-theme';

export function getTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    // storage unavailable (private mode, blocked): fall back to the system preference
  }
  return 'system';
}

/** Sets `.dark` on <html> from the stored choice (system = prefers-color-scheme). */
export function applyTheme(): void {
  const t = getTheme();
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

export function setTheme(t: Theme): void {
  try {
    if (t === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {
    // not persisted; the choice still applies for this page view
  }
  applyTheme();
}
