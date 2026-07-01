import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { appDataPath, inTauri, broadcastShopSell, useBoxes } from './bridge';
import { getItemNames, resolveItemName } from './itemNames';
import { useSettings } from './settings';

// A full auto-sell list of item names (like the drop list). The addon sells any
// listed item it finds in inventory whenever a shop opens. Names resolve to ids
// at sync time, so the addon keeps taking ids.
export type ShopSellConfig = { items: string[]; auto: boolean; anywhere: boolean };

let cfg: ShopSellConfig = { items: [], auto: false, anywhere: false };
let started = false;
let ready = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

async function load() {
  if (started) return;
  started = true;
  if (inTauri) {
    try {
      const txt = await invoke<string>('read_text_file', { path: await appDataPath('shop_sell.json') });
      const p = JSON.parse(txt);
      if (p && Array.isArray(p.items)) cfg = { items: p.items.filter((x: unknown): x is string => typeof x === 'string'), auto: !!p.auto, anywhere: !!p.anywhere };
    } catch { /* none saved */ }
  }
  ready = true;
  cfg = { ...cfg };
  notify();
}
if (inTauri) void load(); else ready = true;

async function save() {
  if (!inTauri) return;
  try { await invoke('write_text_file', { path: await appDataPath('shop_sell.json'), contents: JSON.stringify(cfg) }); } catch { /* ignore */ }
}

export function setShopSell(next: ShopSellConfig) { cfg = next; notify(); void save(); }

export function useShopSell(): ShopSellConfig {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => cfg, () => cfg);
}

function resolveIds(names: string[]): number[] {
  const byLower = new Map(getItemNames().map((it) => [it.n.toLowerCase(), it.id]));
  const ids: number[] = [];
  for (const n of names) {
    const id = byLower.get(n.toLowerCase()) ?? resolveItemName(n)?.id;
    if (id != null) ids.push(id);
  }
  return ids;
}

export function useShopSellSync() {
  const boxes = useBoxes();
  const c = useShopSell();
  const exp = useSettings().experimentalFeatures;
  const onlineKey = useMemo(() => boxes.map((b) => b.conn).sort((a, b) => a - b).join(','), [boxes]);
  useEffect(() => {
    if (!ready) return;
    void broadcastShopSell(resolveIds(c.items), c.auto, c.anywhere && exp);
  }, [c.items, c.auto, c.anywhere, exp, onlineKey]);
}
