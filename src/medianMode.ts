import { invoke } from '@tauri-apps/api/core';
import { useSyncExternalStore } from 'react';
import { appDataPath, inTauri } from './bridge';

// Per-item median DISPLAY mode: true = show the STACK median, false = single/each. Persisted to
// median_mode.json (only the stack-mode entries are written; absence = single). Shared across the
// Inventory list and My Bazaar so a preference set in one place holds everywhere.
const modes = new Map<number, boolean>();
let started = false;
let version = 0;
const subs = new Set<() => void>();
const notify = () => { version++; subs.forEach((s) => s()); };

async function load() {
  if (started) return;
  started = true;
  if (!inTauri) return;
  try {
    const txt = await invoke<string>('read_text_file', { path: await appDataPath('median_mode.json') });
    const p = JSON.parse(txt);
    if (p && typeof p === 'object') for (const k of Object.keys(p)) { const id = Number(k); if (id > 0 && p[k]) modes.set(id, true); }
    notify();
  } catch { /* none saved -- keep defaults */ }
}
if (inTauri) void load();

async function save() {
  if (!inTauri) return;
  const obj: Record<string, 1> = {};
  for (const [id, v] of modes) if (v) obj[id] = 1;
  try { await invoke('write_text_file', { path: await appDataPath('median_mode.json'), contents: JSON.stringify(obj) }); } catch { /* ignore */ }
}

export function getMedianStack(id: number): boolean { return modes.get(id) ?? false; }

export function toggleMedianStack(id: number) {
  if (getMedianStack(id)) modes.delete(id); else modes.set(id, true);
  notify();
  void save();
}

// Reactive read for a single item (use inside a component).
export function useMedianStack(id: number): boolean {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => modes.get(id) ?? false, () => false);
}

// Bump-on-any-change tick, for lists that read getMedianStack() inline in a .map (where a per-row hook
// would break the rules of hooks) but still need to re-render when a toggle lands.
export function useMedianModeTick(): number {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => version, () => version);
}
