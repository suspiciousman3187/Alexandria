import { invoke } from '@tauri-apps/api/core';
import { useSyncExternalStore, useEffect, useMemo } from 'react';
import { appDataPath, inTauri, broadcastBoxCommand, useBoxes } from './bridge';

// User-tunable pacing (seconds) for the bazaar SCAN. The random ones use base + up to `jitter` extra, so a
// human-like spread. Pushed to the addon (bzdelays command); defaults mirror the addon's built-in values.
export type Pace = { base: number; jitter: number };
export type BazaarDelays = {
  examineOpen: Pace;     // /check the player, then open their bazaar this many seconds later
  collectStocked: number; // quiet gap after the last listed item before a stocked bazaar is "done"
  collectEmpty: number;   // grace before concluding a bazaar is empty (nothing streamed)
  browseExit: Pace;       // browse a beat, then leave
  betweenSellers: Pace;   // pause before moving to the next seller
};

export const BZ_DELAY_DEFAULTS: BazaarDelays = {
  examineOpen: { base: 3, jitter: 2 },
  collectStocked: 0.6,
  collectEmpty: 2.0,
  browseExit: { base: 0.8, jitter: 1.2 },
  betweenSellers: { base: 0.6, jitter: 0.8 },
};

// Field catalog for the editor: label, help, and which part(s) are tunable.
export const BZ_DELAY_FIELDS: { key: keyof BazaarDelays; label: string; help: string; pace: boolean }[] = [
  { key: 'examineOpen', label: 'Examine → Open Bazaar', help: 'Check the player, wait, then open their bazaar.', pace: true },
  { key: 'collectStocked', label: 'Listing Settle', help: 'Delay between last list read is completed.', pace: false },
  { key: 'collectEmpty', label: 'Empty-Bazaar Check', help: 'How long to wait before concluding a bazaar is empty.', pace: false },
  { key: 'browseExit', label: 'Browse → Leave', help: 'Delay between browsing a bazaar then leaving.', pace: true },
  { key: 'betweenSellers', label: 'Per Bazaar Delay', help: 'Delay before moving onto next bazaar.', pace: true },
];

const clamp = (n: unknown, d: number) => (typeof n === 'number' && isFinite(n) && n >= 0 ? n : d);
const pace = (p: unknown, d: Pace): Pace => { const o = (p ?? {}) as Partial<Pace>; return { base: clamp(o.base, d.base), jitter: clamp(o.jitter, d.jitter) }; };
function sanitize(p: unknown): BazaarDelays {
  const o = (p ?? {}) as Partial<BazaarDelays>;
  return {
    examineOpen: pace(o.examineOpen, BZ_DELAY_DEFAULTS.examineOpen),
    collectStocked: clamp(o.collectStocked, BZ_DELAY_DEFAULTS.collectStocked),
    collectEmpty: clamp(o.collectEmpty, BZ_DELAY_DEFAULTS.collectEmpty),
    browseExit: pace(o.browseExit, BZ_DELAY_DEFAULTS.browseExit),
    betweenSellers: pace(o.betweenSellers, BZ_DELAY_DEFAULTS.betweenSellers),
  };
}

let cfg: BazaarDelays = sanitize(BZ_DELAY_DEFAULTS);
let started = false;
let ready = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

async function load() {
  if (started) return;
  started = true;
  if (inTauri) {
    try { cfg = sanitize(JSON.parse(await invoke<string>('read_text_file', { path: await appDataPath('bazaar_delays.json') }))); } catch { /* none saved */ }
  }
  ready = true; cfg = { ...cfg }; notify();
}
if (inTauri) void load(); else ready = true;

async function save() {
  if (!inTauri) return;
  try { await invoke('write_text_file', { path: await appDataPath('bazaar_delays.json'), contents: JSON.stringify(cfg) }); } catch { /* ignore */ }
}

export function setBazaarDelays(next: BazaarDelays) { cfg = sanitize(next); notify(); void save(); }
export function useBazaarDelays(): BazaarDelays {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => cfg, () => cfg);
}

export function broadcastBazaarDelays(c: BazaarDelays): Promise<number> {
  return broadcastBoxCommand(JSON.stringify({
    cmd: 'bzdelays',
    open_b: c.examineOpen.base, open_j: c.examineOpen.jitter,
    collect_stocked: c.collectStocked, collect_empty: c.collectEmpty,
    exit_b: c.browseExit.base, exit_j: c.browseExit.jitter,
    seller_b: c.betweenSellers.base, seller_j: c.betweenSellers.jitter,
  }));
}

// Push to every box on change or when a new box connects.
export function useBazaarDelaysSync() {
  const boxes = useBoxes();
  const c = useBazaarDelays();
  const onlineKey = useMemo(() => boxes.map((b) => b.conn).sort((a, b) => a - b).join(','), [boxes]);
  useEffect(() => { if (ready) void broadcastBazaarDelays(c); }, [c, onlineKey]);
}
