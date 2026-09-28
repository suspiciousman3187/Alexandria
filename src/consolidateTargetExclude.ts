import { invoke } from '@tauri-apps/api/core';
import { useSyncExternalStore } from 'react';
import { appDataPath, inTauri } from './bridge';

// Characters the user never wants consolidated TO (excluded as a collector target). They still take part as
// senders -- their spare items still gather onto whichever collector is chosen -- but they can't be picked as the
// destination. File-backed so it persists, mirroring consolidateIgnore.
let store: string[] = [];
let started = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

async function load() {
  if (started) return;
  started = true;
  if (!inTauri) return;
  try {
    const txt = await invoke<string>('read_text_file', { path: await appDataPath('consolidate_target_exclude.json') });
    const p = JSON.parse(txt);
    if (Array.isArray(p)) store = p.filter((x): x is string => typeof x === 'string');
  } catch { /* none saved */ }
  notify();
}
if (inTauri) void load();

async function save() {
  if (!inTauri) return;
  try { await invoke('write_text_file', { path: await appDataPath('consolidate_target_exclude.json'), contents: JSON.stringify(store) }); } catch { /* ignore */ }
}

export function useConsolidateTargetExclude(): string[] {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => store, () => store);
}

export function toggleConsolidateTargetExclude(name: string) {
  const lc = name.toLowerCase();
  store = store.some((x) => x.toLowerCase() === lc) ? store.filter((x) => x.toLowerCase() !== lc) : [...store, name];
  notify();
  void save();
}
