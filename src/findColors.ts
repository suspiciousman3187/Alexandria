import { invoke } from '@tauri-apps/api/core';
import { useSyncExternalStore } from 'react';
import { appDataPath, inTauri, broadcastBoxCommand, useBoxes } from './bridge';
import { useEffect, useMemo } from 'react';

// Color customization for the in-game //find / //findall output. FFXI chat colors are a fixed client palette
// addressed by a code number (the addon turns a code into the 0x1F/0x1E chat bytes). Many codes are duplicates
// or render black, so FIND_PALETTE is a curated set of distinct, legible ones. The swatch hex is APPROXIMATE:
// the true color is whatever the client renders, so the picker also shows the code and players can confirm with
// //ax colortest in-game. Only the code travels to the addon.
//
// NOTE: the hex values below are best-effort approximations. To make them exact, sample a //ax colortest capture.
export type FindColor = { code: number; hex: string; name: string };

export const FIND_PALETTE: FindColor[] = [
  { code: 1, hex: '#ececec', name: 'White' },
  { code: 8, hex: '#9a9a9a', name: 'Gray' },
  { code: 5, hex: '#ff5a5a', name: 'Red' },
  { code: 6, hex: '#ff9b3d', name: 'Orange' },
  { code: 36, hex: '#ffe24b', name: 'Yellow' },
  { code: 259, hex: '#e0943d', name: 'Amber' },
  { code: 262, hex: '#d4b84f', name: 'Gold' },
  { code: 213, hex: '#74c974', name: 'Green' },
  { code: 256, hex: '#8fd44f', name: 'Lime' },
  { code: 363, hex: '#a0c070', name: 'Olive' },
  { code: 326, hex: '#70c0a0', name: 'Mint' },
  { code: 205, hex: '#49c9c9', name: 'Teal' },
  { code: 210, hex: '#8fa0c0', name: 'Slate' },
  { code: 324, hex: '#5f82e0', name: 'Blue' },
  { code: 340, hex: '#70a0c0', name: 'Sky' },
  { code: 209, hex: '#a96fd4', name: 'Purple' },
  { code: 367, hex: '#b0a0d0', name: 'Lavender' },
  { code: 208, hex: '#d46fb4', name: 'Magenta' },
  { code: 211, hex: '#ff9bd4', name: 'Pink' },
  { code: 342, hex: '#c07070', name: 'Rose' },
  { code: 364, hex: '#c0c070', name: 'Sand' },
];

export const FIND_PALETTE_BY_CODE = new Map(FIND_PALETTE.map((c) => [c.code, c]));

// Every bag that can appear in a find line, with the display label the addon prints (and lowercases to key its
// color). `key` must match the addon's bag name exactly (lowercased).
export const FIND_BAGS: { key: string; label: string }[] = [
  { key: 'inventory', label: 'Inventory' },
  { key: 'safe', label: 'Safe' },
  { key: 'safe 2', label: 'Safe 2' },
  { key: 'storage', label: 'Storage' },
  { key: 'locker', label: 'Locker' },
  { key: 'satchel', label: 'Satchel' },
  { key: 'sack', label: 'Sack' },
  { key: 'case', label: 'Case' },
  { key: 'wardrobe', label: 'Wardrobe' },
  { key: 'wardrobe 2', label: 'Wardrobe 2' },
  { key: 'wardrobe 3', label: 'Wardrobe 3' },
  { key: 'wardrobe 4', label: 'Wardrobe 4' },
  { key: 'wardrobe 5', label: 'Wardrobe 5' },
  { key: 'wardrobe 6', label: 'Wardrobe 6' },
  { key: 'wardrobe 7', label: 'Wardrobe 7' },
  { key: 'wardrobe 8', label: 'Wardrobe 8' },
];

// 0 = use the addon's built-in default for that element. Defaults below mirror the addon's AX_BAG_COLOR so a
// fresh install looks identical until the user changes something.
export type FindColors = { name: number; item: number; bags: Record<string, number> };

export const FIND_DEFAULTS: FindColors = {
  name: 0,
  item: 0,
  bags: {
    'inventory': 205, 'safe': 208, 'safe 2': 209, 'storage': 210, 'locker': 213,
    'satchel': 259, 'sack': 324, 'case': 262, 'wardrobe': 256, 'wardrobe 2': 364, 'wardrobe 3': 326,
    'wardrobe 4': 342, 'wardrobe 5': 340, 'wardrobe 6': 367, 'wardrobe 7': 363, 'wardrobe 8': 8,
  },
};

let cfg: FindColors = { ...FIND_DEFAULTS, bags: { ...FIND_DEFAULTS.bags } };
let started = false;
let ready = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

function sanitize(p: unknown): FindColors {
  const o = (p ?? {}) as Partial<FindColors>;
  const bags: Record<string, number> = { ...FIND_DEFAULTS.bags };
  if (o.bags && typeof o.bags === 'object') for (const b of FIND_BAGS) { const v = (o.bags as Record<string, unknown>)[b.key]; if (typeof v === 'number') bags[b.key] = v; }
  return { name: typeof o.name === 'number' ? o.name : 0, item: typeof o.item === 'number' ? o.item : 0, bags };
}

async function load() {
  if (started) return;
  started = true;
  if (inTauri) {
    try { cfg = sanitize(JSON.parse(await invoke<string>('read_text_file', { path: await appDataPath('find_colors.json') }))); } catch { /* none saved */ }
  }
  ready = true;
  cfg = { ...cfg };
  notify();
}
if (inTauri) void load(); else ready = true;

async function save() {
  if (!inTauri) return;
  try { await invoke('write_text_file', { path: await appDataPath('find_colors.json'), contents: JSON.stringify(cfg) }); } catch { /* ignore */ }
}

export function setFindColors(next: FindColors) { cfg = next; notify(); void save(); }
export function useFindColors(): FindColors {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => cfg, () => cfg);
}

export function broadcastFindColors(c: FindColors): Promise<number> {
  return broadcastBoxCommand(JSON.stringify({ cmd: 'findcolors', name: c.name, item: c.item, bags: c.bags }));
}

// Push the colors to every box on change or when the online set changes (so a newly connected box gets them).
export function useFindColorsSync() {
  const boxes = useBoxes();
  const c = useFindColors();
  const onlineKey = useMemo(() => boxes.map((b) => b.conn).sort((a, b) => a - b).join(','), [boxes]);
  useEffect(() => { if (ready) void broadcastFindColors(c); }, [c, onlineKey]);
}
