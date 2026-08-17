import { useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { appDataPath, inTauri } from './bridge';

let list: string[] = [];
let loaded = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

async function load() {
  if (loaded) return;
  loaded = true;
  if (!inTauri) return;
  try {
    const txt = await invoke<string>('read_text_file', { path: await appDataPath('bz_blacklist.json') });
    const p = JSON.parse(txt);
    if (Array.isArray(p)) { list = p.filter((x: unknown): x is string => typeof x === 'string'); notify(); }
  } catch {}
}
if (inTauri) void load();

async function save() {
  if (!inTauri) return;
  try { await invoke('write_text_file', { path: await appDataPath('bz_blacklist.json'), contents: JSON.stringify(list) }); } catch {}
}

export function useBzBlacklist(): string[] {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => list, () => list);
}

export function addBzBlacklist(name: string) {
  const n = name.trim();
  if (!n || list.some((x) => x.toLowerCase() === n.toLowerCase())) return;
  list = [...list, n];
  notify();
  void save();
}

export function removeBzBlacklist(name: string) {
  const lc = name.toLowerCase();
  const next = list.filter((n) => n.toLowerCase() !== lc);
  if (next.length === list.length) return;
  list = next;
  notify();
  void save();
}
