import { useSyncExternalStore } from 'react';

export type ThemeId = '' | 'lesserevil' | 'gnosis' | 'dawn';

export const THEMES: { id: ThemeId; label: string }[] = [
  { id: '', label: 'Alexandria' },
  { id: 'lesserevil', label: 'Lesser Evil' },
  { id: 'gnosis', label: 'Gnosis' },
  { id: 'dawn', label: 'Dawn' },
];

const KEY = 'alexandria-theme';

function read(): ThemeId {
  try {
    const v = localStorage.getItem(KEY) as ThemeId | null;
    if (v === 'lesserevil' || v === 'gnosis' || v === 'dawn') return v;
  } catch { /* ignore */ }
  return '';
}

let theme = read();
function apply() {
  if (typeof document === 'undefined') return;
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}
apply();

const listeners = new Set<() => void>();
export function setTheme(v: ThemeId) {
  theme = v;
  apply();
  try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}
export function useTheme(): [ThemeId, (v: ThemeId) => void] {
  const t = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => theme, () => theme);
  return [t, setTheme];
}
