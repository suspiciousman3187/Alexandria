import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { appDataPath, inTauri, broadcastShopNpcs } from './bridge';

export type MenuShortcut = { npc: string; option: number; label: string };

const SEED: MenuShortcut[] = [{ npc: 'Curio Vendor Moogle', option: 4, label: 'Food' }];

let list: MenuShortcut[] = SEED;
let started = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

async function load() {
  if (started) return;
  started = true;
  if (inTauri) {
    try {
      const txt = await invoke<string>('read_text_file', { path: await appDataPath('menu_shortcuts.json') });
      const p = JSON.parse(txt);
      if (Array.isArray(p)) {
        const migrated = p
          .map((x) => {
            if (x && typeof x.npc === 'string' && typeof x.option === 'number') return x as MenuShortcut;
            // Legacy menu-id-keyed entries: all the user's were the Curio Vendor Moogle (menu 9601).
            if (x && x.menu === 9601 && typeof x.option === 'number') return { npc: 'Curio Vendor Moogle', option: x.option, label: String(x.label ?? `Option ${x.option}`) };
            return null;
          })
          .filter((x): x is MenuShortcut => !!x);
        list = migrated.length > 0 ? migrated : SEED;
        if (migrated.some((m, i) => m !== p[i])) void save();
      }
    } catch { /* keep seed */ }
  }
  list = [...list];
  notify();
}
if (inTauri) void load();

async function save() {
  if (!inTauri) return;
  try { await invoke('write_text_file', { path: await appDataPath('menu_shortcuts.json'), contents: JSON.stringify(list) }); } catch { /* ignore */ }
}

export function useMenuShortcuts(): MenuShortcut[] {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => list, () => list);
}

export function addShortcut(s: MenuShortcut) {
  if (list.some((x) => x.npc === s.npc && x.option === s.option)) {
    list = list.map((x) => (x.npc === s.npc && x.option === s.option ? s : x));
  } else {
    list = [...list, s];
  }
  notify();
  void save();
}

export function removeShortcut(npc: string, option: number) {
  list = list.filter((x) => !(x.npc === npc && x.option === option));
  notify();
  void save();
}

export function useShopNpcSync() {
  const shortcuts = useMenuShortcuts();
  const names = useMemo(() => [...new Set(shortcuts.map((s) => s.npc))], [shortcuts]);
  const namesKey = names.join('|');
  const namesRef = useRef(names);
  namesRef.current = names;
  useEffect(() => {
    void broadcastShopNpcs(namesRef.current);
    const t = setInterval(() => { void broadcastShopNpcs(namesRef.current); }, 8000);
    return () => clearInterval(t);
  }, [namesKey]);
}
