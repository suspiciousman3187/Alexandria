import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { appDataPath, inTauri, broadcastDropRules, useBoxes } from './bridge';
import { DROP_DEFAULT } from './dropDefaults';

export type DropConfig = { drop: string[]; autoDrop: boolean; dropDelay?: number; skipDropConfirm?: boolean; skipAddConfirm?: boolean };

let cfg: DropConfig = { drop: DROP_DEFAULT, autoDrop: false, dropDelay: 0 };
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
      if (p && Array.isArray(p.drop)) cfg = { drop: p.drop, autoDrop: !!p.autoDrop, dropDelay: Number(p.dropDelay) || 0, skipDropConfirm: !!p.skipDropConfirm, skipAddConfirm: !!p.skipAddConfirm };
    } catch { /* none saved — keep preseeded default */ }
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
  useEffect(() => {
    if (!ready) return;
    void broadcastDropRules({ drop: c.drop, autodrop: c.autoDrop, delay: c.dropDelay ?? 0 });
  }, [c.drop, c.autoDrop, c.dropDelay, onlineKey]);
}
