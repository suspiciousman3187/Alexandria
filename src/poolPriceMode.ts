import { invoke } from '@tauri-apps/api/core';
import { useSyncExternalStore } from 'react';
import { appDataPath, inTauri } from './bridge';

export type PriceMode = 'single' | 'stack';

let defaultMode: PriceMode = 'single';
let store: Record<number, PriceMode> = {};
let started = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

async function load() {
  if (started) return;
  started = true;
  if (!inTauri) return;
  try {
    const txt = await invoke<string>('read_text_file', { path: await appDataPath('pool_price_mode.json') });
    const p = JSON.parse(txt) as Record<string, unknown>;
    if (p && typeof p === 'object') {
      const wrapped = typeof p.default === 'string' || (p.items != null && typeof p.items === 'object');
      if (wrapped && (p.default === 'single' || p.default === 'stack')) defaultMode = p.default;
      const raw = (wrapped ? p.items : p) as Record<string, unknown>;
      const next: Record<number, PriceMode> = {};
      if (raw && typeof raw === 'object') for (const k in raw) { const id = Number(k); if (id > 0 && (raw[k] === 'stack' || raw[k] === 'single')) next[id] = raw[k] as PriceMode; }
      store = next;
    }
  } catch { /* none saved */ }
  notify();
}
if (inTauri) void load();

async function save() {
  if (!inTauri) return;
  try { await invoke('write_text_file', { path: await appDataPath('pool_price_mode.json'), contents: JSON.stringify({ default: defaultMode, items: store }) }); } catch { /* ignore */ }
}

export function usePoolPriceMode(): Record<number, PriceMode> {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => store, () => store);
}

export function setPoolPriceMode(id: number, mode: PriceMode | null) {
  const next = { ...store };
  if (mode == null) delete next[id]; else next[id] = mode;
  store = next;
  notify();
  void save();
}

export function usePoolPriceDefault(): PriceMode {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => defaultMode, () => defaultMode);
}

export function setPoolPriceDefault(mode: PriceMode) {
  defaultMode = mode;
  notify();
  void save();
}
