import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { appDataPath, inTauri, sendDropRules, useBoxes, dropOne, getKnownCharacters, nomadReachable, type KnownChar } from './bridge';
import { ALWAYS_BAGS, MOG_ONLY_BAGS } from './bagConstants';
import { DROP_DEFAULT } from './dropDefaults';

// A bag we can drop from on `c`: always-carried bags directly, Mog bags only while at a
// Mog House or Nomad Moogle (the addon moves a non-inventory stack to inventory, then drops).
function partyDropReachable(c: KnownChar, bagId: number, experimental: boolean): boolean {
  if (ALWAYS_BAGS.has(bagId)) return true;
  if (MOG_ONLY_BAGS.has(bagId)) return !!c.mog || nomadReachable(c, experimental);
  return false;
}

// Total of item `id` held across every connected character's reachable bags, and how many
// characters hold it. Used for the "Drop All On Party" count and the //ax dropall summary.
export function countItemEverywhere(id: number, experimental: boolean): { items: number; chars: number } {
  let items = 0;
  let chars = 0;
  for (const c of getKnownCharacters()) {
    if (!c.online || c.conn == null) continue;
    let cn = 0;
    for (const bg of c.inv ?? []) {
      if (!partyDropReachable(c, bg.id, experimental)) continue;
      for (const it of bg.items) if (it.id === id) cn += it.c;
    }
    if (cn > 0) { items += cn; chars += 1; }
  }
  return { items, chars };
}

// Drop every reachable copy of `id` on every connected character. The single source of
// truth shared by the "Drop All On Party" action and the //ax dropall command.
export function dropItemEverywhere(id: number, experimental: boolean): { items: number; chars: number } {
  let items = 0;
  let chars = 0;
  for (const c of getKnownCharacters()) {
    if (!c.online || c.conn == null) continue;
    let cn = 0;
    for (const bg of c.inv ?? []) {
      if (!partyDropReachable(c, bg.id, experimental)) continue;
      for (const it of bg.items) if (it.id === id) { dropOne(c.conn, it.s, it.id, bg.id, it.c); cn += it.c; }
    }
    if (cn > 0) { items += cn; chars += 1; }
  }
  return { items, chars };
}

// `exclude` = character names that are opted out of auto-drop entirely (e.g. crafting
// mules that use drop-list items). They receive an empty rule set, so neither auto-drop
// nor a broadcast Drop-Now touches them.
export type DropConfig = { drop: string[]; autoDrop: boolean; dropDelay?: number; skipDropConfirm?: boolean; skipAddConfirm?: boolean; reviewed?: boolean; exclude?: string[] };

let cfg: DropConfig = { drop: DROP_DEFAULT, autoDrop: false, dropDelay: 0, exclude: [] };
let started = false;
let ready = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

async function load() {
  if (started) return;
  started = true;
  if (inTauri) {
    try {
      const txt = await invoke<string>('read_text_file', { path: await appDataPath('drop_config.json') });
      const p = JSON.parse(txt);
      if (p && Array.isArray(p.drop)) cfg = { drop: p.drop, autoDrop: !!p.autoDrop, dropDelay: Number(p.dropDelay) || 0, skipDropConfirm: !!p.skipDropConfirm, skipAddConfirm: !!p.skipAddConfirm, reviewed: p.reviewed === undefined ? !!p.autoDrop : !!p.reviewed, exclude: Array.isArray(p.exclude) ? p.exclude.filter((n: unknown): n is string => typeof n === 'string') : [] };
    } catch { /* none saved, keep preseeded default */ }
  }
  ready = true;
  cfg = { ...cfg };
  notify();
}
if (inTauri) void load(); else ready = true;

async function save() {
  if (!inTauri) return;
  try { await invoke('write_text_file', { path: await appDataPath('drop_config.json'), contents: JSON.stringify(cfg) }); } catch { /* ignore */ }
}

export function setDrop(next: DropConfig) { cfg = next; notify(); void save(); }
export function getDrop(): DropConfig { return cfg; }

export function useDrop(): DropConfig {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => cfg, () => cfg);
}

export function useDropSync() {
  const boxes = useBoxes();
  const c = useDrop();
  const onlineKey = useMemo(() => boxes.map((b) => b.conn).sort((a, b) => a - b).join(','), [boxes]);
  const excludeKey = (c.exclude ?? []).join('|');
  useEffect(() => {
    if (!ready) return;
    const excl = new Set(c.exclude ?? []);
    for (const b of boxes) {
      if (b.conn == null) continue;
      const off = excl.has(b.name);
      sendDropRules(b.conn, { drop: off ? [] : c.drop, autodrop: off ? false : c.autoDrop, delay: c.dropDelay ?? 0 });
    }
  }, [c.drop, c.autoDrop, c.dropDelay, excludeKey, onlineKey]);
}
