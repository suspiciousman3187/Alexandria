import type { KnownChar } from './bridge';

// Canonical bag id <-> name mapping, shared by the Library grid and the Organize
// flow so the report and routing use one source of truth.
export const BAG_ORDER: { id: number; name: string }[] = [
  { id: 0, name: 'Inventory' }, { id: 1, name: 'Mog Safe' }, { id: 9, name: 'Mog Safe 2' },
  { id: 2, name: 'Storage' }, { id: 4, name: 'Mog Locker' }, { id: 5, name: 'Mog Satchel' },
  { id: 6, name: 'Mog Sack' }, { id: 7, name: 'Mog Case' },
  { id: 8, name: 'Wardrobe 1' }, { id: 10, name: 'Wardrobe 2' }, { id: 11, name: 'Wardrobe 3' },
  { id: 12, name: 'Wardrobe 4' }, { id: 13, name: 'Wardrobe 5' }, { id: 14, name: 'Wardrobe 6' },
  { id: 15, name: 'Wardrobe 7' }, { id: 16, name: 'Wardrobe 8' },
];

export const bagName = (id: number) => BAG_ORDER.find((b) => b.id === id)?.name ?? `Bag ${id}`;

// Map an organize step's bag-name string (e.g. "Storage", "Mog Satchel") to a bag id.
export const bagIdByName = (ch: KnownChar | undefined, name: string): number | null => {
  const lc = name.trim().toLowerCase();
  for (const b of ch?.inv ?? []) if (b.b.toLowerCase() === lc) return b.id;
  const stripped = lc.replace(/^mog\s+/, '');
  const bo = BAG_ORDER.find((b) => { const n = b.name.toLowerCase(); return n === lc || n.replace(/^mog\s+/, '') === stripped; });
  return bo?.id ?? null;
};
