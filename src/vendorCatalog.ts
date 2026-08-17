// Proximity Buy/Sell vendors (Sortie first). FFXI exposes no way to know an NPC is a
// merchant or what it sells until you open its shop, so these are curated: NPC name -> the
// item ids it sells. The addon drives them entirely by packets (poke -> shop list -> buy),
// never keypresses. Grow this list as more vendors are mapped -- each entry is three lines.

export type VendorItem = { id: number; n: string; single: boolean; stack: number };
export type Vendor = { npc: string; zoneName: string; items: number[] };

// Every distinct item any cataloged vendor sells (what the UI lets you set targets for).
// `single`: buys one per purchase packet (single-slot items); the addon caps to this anyway.
export const VENDOR_ITEMS: VendorItem[] = [
  { id: 5944, n: 'Frontier Soda', single: true, stack: 1 },
  { id: 18259, n: 'Angon', single: false, stack: 99 },
  { id: 18258, n: 'Thr. Tomahawk', single: false, stack: 99 },
  { id: 5870, n: 'Trump Card Case', single: false, stack: 12 },
];

export const VENDORS: Vendor[] = [
  { npc: 'Preterig', zoneName: 'Sortie', items: [5944] },
  { npc: 'Bernegeois', zoneName: 'Sortie', items: [5944] },
  { npc: 'Hagakoff', zoneName: 'Sortie', items: [18259] },
  { npc: 'Wata Khamazom', zoneName: 'Sortie', items: [18258] },
  { npc: 'Jajaroon', zoneName: 'Sortie', items: [5870] },
];

const byId = new Map(VENDOR_ITEMS.map((i) => [i.id, i]));
const byNameLc = new Map(VENDOR_ITEMS.map((i) => [i.n.toLowerCase(), i]));

export const vendorItemById = (id: number): VendorItem | undefined => byId.get(id);
export const vendorItemByName = (name: string): VendorItem | undefined => byNameLc.get(name.toLowerCase());

// Which vendors sell a given item, for the "sold by …" hint in the UI.
export const vendorsSelling = (id: number): string[] => VENDORS.filter((v) => v.items.includes(id)).map((v) => v.npc);
