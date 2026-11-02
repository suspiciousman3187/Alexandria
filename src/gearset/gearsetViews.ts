import { useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { appDataPath, inTauri } from '../bridge';

// A named stat display set: the exact stat keys to show in the Gearset Stats panel. `activeId` null means the
// built-in "All stats" view. `collapsed` holds section titles the user has folded. Gearsets-window-only display
// prefs, stored in their own file (the shared sticky store's whole-map save would let the main window clobber them).
export type StatView = { id: string; name: string; keys: string[] };
type Store = { views: StatView[]; activeId: string | null; collapsed: string[]; bright?: number; blur?: number };

export const BRIGHT_DEFAULT = 0.6, BLUR_DEFAULT = 0;
const FILE = 'gearset_views.json';
let store: Store = { views: [], activeId: null, collapsed: [] };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

async function load() {
  if (!inTauri) return;
  try {
    const txt = await invoke<string>('read_text_file', { path: await appDataPath(FILE) });
    const s = JSON.parse(txt) as Store;
    if (s && typeof s === 'object') { store = { views: s.views ?? [], activeId: s.activeId ?? null, collapsed: s.collapsed ?? [], bright: s.bright, blur: s.blur }; emit(); }
  } catch { /* none yet */ }
}
void load();

let saveTimer: number | undefined;
function commit(next: Store) {
  store = next;
  emit();
  if (!inTauri) return;
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    try { await invoke('write_text_file', { path: await appDataPath(FILE), contents: JSON.stringify(store) }); } catch { /* ignore */ }
  }, 300);
}
const sub = (cb: () => void) => { subs.add(cb); return () => subs.delete(cb); };
const rid = () => Math.random().toString(36).slice(2, 9);

export function useViews(): Store {
  useSyncExternalStore(sub, () => store, () => store);
  return store;
}
export function addView(name: string, keys: string[]): string {
  const v: StatView = { id: rid(), name: name.trim() || 'View', keys };
  commit({ ...store, views: [...store.views, v], activeId: v.id });
  return v.id;
}
export function updateView(id: string, patch: Partial<StatView>): void {
  commit({ ...store, views: store.views.map((v) => (v.id === id ? { ...v, ...patch } : v)) });
}
export function removeView(id: string): void {
  commit({ ...store, views: store.views.filter((v) => v.id !== id), activeId: store.activeId === id ? null : store.activeId });
}
export function setActiveView(id: string | null): void { commit({ ...store, activeId: id }); }
export function toggleCollapsed(title: string): void {
  const has = store.collapsed.includes(title);
  commit({ ...store, collapsed: has ? store.collapsed.filter((t) => t !== title) : [...store.collapsed, title] });
}
export function setAppearance(patch: { bright?: number; blur?: number }): void { commit({ ...store, ...patch }); }
