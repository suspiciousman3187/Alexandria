import { invoke } from '@tauri-apps/api/core';
import { useSyncExternalStore } from 'react';
import { appDataPath, inTauri } from './bridge';

// Saved exclusions for the Store/Retrieve-for-job actions, per character and direction. Each array holds the
// item ids the user chose to leave out; they persist so the next preview starts pre-configured.
type Dir = 'store' | 'retrieve';
type CharCfg = { store: number[]; retrieve: number[] };
type Config = Record<string, CharCfg>;

let cfg: Config = {};
let started = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

async function load() {
  if (started) return;
  started = true;
  if (!inTauri) return;
  try {
    const txt = await invoke<string>('read_text_file', { path: await appDataPath('slip_op_exclusions.json') });
    const p = JSON.parse(txt);
    if (p && typeof p === 'object') {
      const clean: Config = {};
      for (const [name, v] of Object.entries<any>(p)) {
        const arr = (x: any) => (Array.isArray(x) ? x.map(Number).filter((n) => Number.isFinite(n)) : []);
        clean[name] = { store: arr(v?.store), retrieve: arr(v?.retrieve) };
      }
      cfg = clean;
      notify();
    }
  } catch { /* none saved */ }
}
if (inTauri) void load();

async function save() {
  if (!inTauri) return;
  try { await invoke('write_text_file', { path: await appDataPath('slip_op_exclusions.json'), contents: JSON.stringify(cfg) }); } catch { /* ignore */ }
}

const EMPTY: number[] = [];
export function getSlipExclusions(char: string | undefined, dir: Dir): number[] {
  if (!char) return EMPTY;
  return cfg[char]?.[dir] ?? EMPTY;
}
export function setSlipExclusions(char: string | undefined, dir: Dir, ids: number[]) {
  if (!char) return;
  const cur = cfg[char] ?? { store: [], retrieve: [] };
  cfg = { ...cfg, [char]: { ...cur, [dir]: [...new Set(ids)] } };
  notify();
  void save();
}
export function useSlipExclusions(char: string | undefined, dir: Dir): number[] {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => getSlipExclusions(char, dir), () => getSlipExclusions(char, dir));
}
