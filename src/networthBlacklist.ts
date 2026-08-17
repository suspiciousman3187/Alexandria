import { invoke } from '@tauri-apps/api/core';
import { useSyncExternalStore } from 'react';
import { appDataPath, inTauri } from './bridge';

let ids = new Set<number>();
let started = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

async function load() {
  if (started) return;
  started = true;
  if (!inTauri) return;
  try {
    const txt = await invoke<string>('read_text_file', { path: await appDataPath('networth_blacklist.json') });
    const p = JSON.parse(txt);
    if (Array.isArray(p?.ids)) { ids = new Set(p.ids.map(Number).filter((n: number) => n > 0)); notify(); }
  } catch { /* none saved */ }
}
if (inTauri) void load();

async function save() {
  if (!inTauri) return;
  try { await invoke('write_text_file', { path: await appDataPath('networth_blacklist.json'), contents: JSON.stringify({ ids: [...ids] }) }); } catch { /* ignore */ }
}

export function addBlacklist(id: number) {
  if (id > 0 && !ids.has(id)) { ids = new Set(ids).add(id); notify(); void save(); }
}
export function removeBlacklist(id: number) {
  if (ids.has(id)) { const n = new Set(ids); n.delete(id); ids = n; notify(); void save(); }
}
export function useNetworthBlacklist(): Set<number> {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => ids, () => ids);
}
