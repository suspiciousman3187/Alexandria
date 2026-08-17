// The in-game auction-house category tree. id -> "Top->Sub[->Leaf]" path,
// ported from Auctioneer's data/categories.lua. The catalog tags each item with
// its category id (`ac`); the Browse filter drills down Top -> Subcategory.

export const AH_CATEGORY_PATH: Record<number, string> = {
  0: 'None',
  1: 'Weapons->Hand-to-Hand',
  2: 'Weapons->Daggers',
  3: 'Weapons->Swords',
  4: 'Weapons->Great Swords',
  5: 'Weapons->Axes',
  6: 'Weapons->Great Axes',
  7: 'Weapons->Scythes',
  8: 'Weapons->Polearms',
  9: 'Weapons->Katana',
  10: 'Weapons->Great Katana',
  11: 'Weapons->Clubs',
  12: 'Weapons->Staves',
  13: 'Weapons->Ranged',
  14: 'Weapons->Instruments',
  15: 'Weapons->Ammo&Misc->Ammunition',
  47: 'Weapons->Ammo&Misc->Fishing Gear',
  48: 'Weapons->Ammo&Misc->Pet Items',
  62: 'Weapons->Ammo&Misc->Grips',
  16: 'Armor->Shields',
  17: 'Armor->Head',
  22: 'Armor->Neck',
  18: 'Armor->Body',
  19: 'Armor->Hands',
  23: 'Armor->Waist',
  20: 'Armor->Legs',
  21: 'Armor->Feet',
  26: 'Armor->Back',
  24: 'Armor->Earrings',
  25: 'Armor->Rings',
  28: 'Scrolls->White Magic',
  29: 'Scrolls->Black Magic',
  32: 'Scrolls->Songs',
  31: 'Scrolls->Ninjutsu',
  30: 'Scrolls->Summoning',
  60: 'Scrolls->Dice',
  45: 'Scrolls->Geomancy',
  33: 'Medicines',
  34: 'Furnishings',
  38: 'Materials->Smithing',
  39: 'Materials->Goldsmithing',
  40: 'Materials->Clothcraft',
  41: 'Materials->Leathercraft',
  42: 'Materials->Bonecraft',
  43: 'Materials->Woodworking',
  44: 'Materials->Alchemy',
  63: 'Materials->Alchemy 2',
  52: 'Food->Meals->Meat&Eggs',
  53: 'Food->Meals->Seafood',
  54: 'Food->Meals->Vegetables',
  55: 'Food->Meals->Soups',
  56: 'Food->Meals->Breads&Rice',
  57: 'Food->Meals->Sweets',
  58: 'Food->Meals->Drinks',
  59: 'Food->Ingredients',
  51: 'Food->Fish',
  35: 'Crystals',
  46: 'Others->Misc.',
  64: 'Others->Misc.2',
  65: 'Others->Misc.3',
  50: 'Others->Beast-Made',
  36: 'Others->Cards',
  49: 'Others->Ninja Tools',
  37: 'Others->Cursed Items',
  61: 'Others->Automatons',
  27: 'Unused',
};

// Display order of category ids, matching the in-game menus.
const ORDER = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 47, 48, 62, 16,
  17, 22, 18, 19, 23, 20, 21, 26, 24, 25, 28, 29, 32, 31, 30, 60, 45, 33, 34, 38,
  39, 40, 41, 42, 43, 44, 63, 52, 53, 54, 55, 56, 57, 58, 59, 51, 35, 46, 64, 65,
  50, 36, 49, 37, 61,
];

export type AhCategoryNode = { id: number; label: string };
export type AhCategoryGroup = { top: string; subs: AhCategoryNode[] };

// Build the two-level tree (top group -> subcategories) in menu order. A path
// like "Weapons->Ammo&Misc->Ammunition" collapses to sub label "Ammo&Misc /
// Ammunition" so the deepest leaves stay selectable without a third level.
export const AH_CATEGORY_TREE: AhCategoryGroup[] = (() => {
  const groups = new Map<string, AhCategoryNode[]>();
  for (const id of ORDER) {
    const path = AH_CATEGORY_PATH[id];
    if (!path) continue;
    const parts = path.split('->');
    const top = parts[0];
    const sub = parts.slice(1).join(' / ') || top;
    if (!groups.has(top)) groups.set(top, []);
    groups.get(top)!.push({ id, label: sub });
  }
  return [...groups.entries()].map(([top, subs]) => ({ top, subs }));
})();

// Leaf label ("Smithing") and full " / "-joined path ("Materials / Smithing") for a category id.
export const acLeaf = (ac?: number) => (ac && AH_CATEGORY_PATH[ac] ? AH_CATEGORY_PATH[ac].split('->').pop() ?? '' : '');
export const acPathLabel = (ac?: number) => (ac && AH_CATEGORY_PATH[ac] ? AH_CATEGORY_PATH[ac].replace(/->/g, ' / ') : '');

// Top-level group name for a category id (for filtering by whole group).
export const AH_CATEGORY_TOP: Record<number, string> = (() => {
  const m: Record<number, string> = {};
  for (const [idStr, path] of Object.entries(AH_CATEGORY_PATH)) m[Number(idStr)] = path.split('->')[0];
  return m;
})();
