import { invoke } from '@tauri-apps/api/core';
import { useSyncExternalStore } from 'react';
import { appDataPath, inTauri } from './bridge';

let store: string[] = [];
let started = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

async function load() {
  if (started) return;
  started = true;
  if (!inTauri) return;
  try {
    const txt = await invoke<string>('read_text_file', { path: await appDataPath('consolidate_ignore.json') });
    const p = JSON.parse(txt);
    if (Array.isArray(p)) store = p.filter((x): x is string => typeof x === 'string');
  } catch { /* none saved */ }
  notify();
}
if (inTauri) void load();

async function save() {
  if (!inTauri) return;
  try { await invoke('write_text_file', { path: await appDataPath('consolidate_ignore.json'), contents: JSON.stringify(store) }); } catch { /* ignore */ }
}

export function useConsolidateIgnore(): string[] {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => store, () => store);
}

export function toggleConsolidateIgnore(name: string) {
  const lc = name.toLowerCase();
  store = store.some((x) => x.toLowerCase() === lc) ? store.filter((x) => x.toLowerCase() !== lc) : [...store, name];
  notify();
  void save();
}
