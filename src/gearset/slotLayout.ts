export type SlotKey =
  | 'main' | 'sub' | 'range' | 'ammo'
  | 'head' | 'neck' | 'left_ear' | 'right_ear'
  | 'body' | 'hands' | 'left_ring' | 'right_ring'
  | 'back' | 'waist' | 'legs' | 'feet';

// equipviewer display order: a 4-column grid matching the in-game equipment window.
export const SLOT_ORDER: SlotKey[] = [
  'main', 'sub', 'range', 'ammo',
  'head', 'neck', 'left_ear', 'right_ear',
  'body', 'hands', 'left_ring', 'right_ring',
  'back', 'waist', 'legs', 'feet',
];

export const SLOT_LABEL: Record<SlotKey, string> = {
  main: 'Main', sub: 'Sub', range: 'Range', ammo: 'Ammo',
  head: 'Head', neck: 'Neck', left_ear: 'Earring 1', right_ear: 'Earring 2',
  body: 'Body', hands: 'Hands', left_ring: 'Ring 1', right_ring: 'Ring 2',
  back: 'Back', waist: 'Waist', legs: 'Legs', feet: 'Feet',
};

// Every GearSwap slot alias -> canonical key (statics.lua slot_map).
const ALIAS: Record<string, SlotKey> = {
  main: 'main', sub: 'sub', range: 'range', ranged: 'range', ammo: 'ammo',
  head: 'head', body: 'body', hands: 'hands', legs: 'legs', feet: 'feet', neck: 'neck', waist: 'waist',
  ear1: 'left_ear', left_ear: 'left_ear', lear: 'left_ear', learring: 'left_ear',
  ear2: 'right_ear', right_ear: 'right_ear', rear: 'right_ear', rearring: 'right_ear',
  ring1: 'left_ring', left_ring: 'left_ring', lring: 'left_ring',
  ring2: 'right_ring', right_ring: 'right_ring', rring: 'right_ring',
  back: 'back',
};

export const SLOT_ALIASES = new Set(Object.keys(ALIAS));

export function canonSlot(key: string): SlotKey | null {
  return ALIAS[key.trim().toLowerCase()] ?? null;
}
