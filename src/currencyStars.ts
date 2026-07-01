import { invoke } from '@tauri-apps/api/core';
import { useSyncExternalStore } from 'react';
import { appDataPath, inTauri } from './bridge';

let stars: string[] = [];
let started = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

async function load() {
  if (started) return;
  started = true;
  if (inTauri) {
    try {
      const txt = await invoke<string>('read_text_file', { path: await appDataPath('currency_stars.json') });
      const p = JSON.parse(txt);
      if (Array.isArray(p)) stars = p.filter((x) => typeof x === 'string');
    } catch { /* none saved */ }
  }
  stars = [...stars];
  notify();
}
if (inTauri) void load();

async function save() {
  if (!inTauri) return;
  try { await invoke('write_text_file', { path: await appDataPath('currency_stars.json'), contents: JSON.stringify(stars) }); } catch { /* ignore */ }
}

export function toggleStar(name: string) {
  stars = stars.includes(name) ? stars.filter((n) => n !== name) : [...stars, name];
  notify();
  void save();
}

export function useStars(): string[] {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => stars, () => stars);
}
