// Unity (Reinforcement Points) augmenting. A Unity "+1" piece is reinforced by trading Lustreless Scale / Hide /
// Wing to any Unity concierge. One Lustreless = +5 RP; a piece ranks up when its RP crosses each rank's threshold,
// to a max of R15. Each piece accepts exactly ONE lustreless type (not interchangeable).
//
// The item's current rank AND remaining RP to the next rank are both readable from extdata (augment_system 2):
// rank from a byte, accumulated RP from two bytes, remaining = RANK_TOTAL[rank] - accumulated. See the addon's
// unity decoder; the desktop just receives rank + remainingRP per item.

export type Lustreless = 'scale' | 'hide' | 'wing';

export const LUSTRELESS_ID: Record<Lustreless, number> = { scale: 4086, hide: 4087, wing: 4088 };
export const LUSTRELESS_NAME: Record<Lustreless, string> = {
  scale: 'Lustreless Scale', hide: 'Lustreless Hide', wing: 'Lustreless Wing',
};
export const RP_PER_LUSTRELESS = 5;
export const UNITY_MAX_RANK = 15;

// A brand-new "+1" piece must first be OPENED before it can be augmented: trade the piece + one lustreless
// upgrade item + 30,000 Unity Accolades to any concierge. Opening ranks it to R1, after which the normal
// lustreless augmenting applies. A piece reads as unopened when it carries no stored Unity rank (ur) yet.
export const UNITY_OPEN_ACCOLADES = 30000;
export const UNITY_OPEN_LUSTRELESS = 1;
export const UNITY_ACCOLADES_NAME = 'Unity Accolades';

// RP required to advance FROM rank r to r+1 (r = 1..14); rank 15 is max. Values from the BG-wiki RP table the
// feature was specced against. NOTE: Windower's extdata lists R13 as 960 instead of 860; verify against a live
// R13 item's NextRP during capture and correct here if needed (only R13 differs).
// Index r = RP to advance FROM rank r to r+1. Rank 0 is a brand-new +1 with no stored augment data yet; the first
// 5 RP (one lustreless) starts it at R1 ("Total RP" R1 = 5, which the table counts as the initial item). R0->R15
// then totals 5955 RP = 1191 items, matching the reference table.
export const RANK_TOTAL: Record<number, number> = {
  0: 5, 1: 50, 2: 80, 3: 120, 4: 170, 5: 220, 6: 280, 7: 340, 8: 410, 9: 480, 10: 560, 11: 650, 12: 750, 13: 860, 14: 980,
};

export type UnityCat = 'weapon' | 'armor' | 'accessory';
export const UNITY_CAT_ORDER: UnityCat[] = ['weapon', 'armor', 'accessory'];
export const UNITY_CAT_LABEL: Record<UnityCat, string> = { weapon: 'Weapon', armor: 'Armor', accessory: 'Accessory' };
export type UnityPiece = { id: number; lustreless: Lustreless; cat: UnityCat };

// Every Unity-augmentable piece keyed by item id -> which lustreless reinforces it. Weapons/shields/grips first;
// armor + accessories appended as their ids are confirmed.
export const UNITY_CATALOG: UnityPiece[] = [
  { id: 20852, lustreless: 'hide', cat: "weapon" },  // Aizkora +1
  { id: 20607, lustreless: 'hide', cat: "weapon" },  // Anathema harpe +1
  { id: 20854, lustreless: 'hide', cat: "weapon" },  // Beheader +1
  { id: 20807, lustreless: 'scale', cat: "weapon" }, // Buramgh +1
  { id: 20697, lustreless: 'wing', cat: "weapon" },  // Combuster +1
  { id: 20508, lustreless: 'wing', cat: "weapon" },  // Comeuppances +1
  { id: 20709, lustreless: 'hide', cat: "weapon" },  // Demers. Degen +1
  { id: 20522, lustreless: 'scale', cat: "weapon" }, // Emeici +1
  { id: 20528, lustreless: 'hide', cat: "weapon" },  // Fists of fury +1
  { id: 20682, lustreless: 'wing', cat: "weapon" },  // Flyssa +1
  { id: 20943, lustreless: 'hide', cat: "weapon" },  // Gae Derg +1
  { id: 21749, lustreless: 'wing', cat: "weapon" },  // Habilitator +1
  { id: 20609, lustreless: 'hide', cat: "weapon" },  // Jugo kukri +1
  { id: 21703, lustreless: 'hide', cat: "weapon" },  // Kladenets +1
  { id: 21035, lustreless: 'scale', cat: "weapon" }, // Kunimune +1
  { id: 20581, lustreless: 'hide', cat: "weapon" },  // Kustawi +1
  { id: 21091, lustreless: 'hide', cat: "weapon" },  // Loxotic mace +1
  { id: 20800, lustreless: 'hide', cat: "weapon" },  // Mdomo axe +1
  { id: 21689, lustreless: 'wing', cat: "weapon" },  // Montante +1
  { id: 21030, lustreless: 'hide', cat: "weapon" },  // Norifusa +1
  { id: 21696, lustreless: 'wing', cat: "weapon" },  // Nullis +1
  { id: 20805, lustreless: 'hide', cat: "weapon" },  // Perun +1
  { id: 21806, lustreless: 'hide', cat: "weapon" },  // Pixquizpan +1
  { id: 20614, lustreless: 'hide', cat: "weapon" },  // Pukulatmuj +1
  { id: 20981, lustreless: 'hide', cat: "weapon" },  // Raicho +1
  { id: 20612, lustreless: 'hide', cat: "weapon" },  // Sangarius +1
  { id: 20988, lustreless: 'scale', cat: "weapon" }, // Tancho +1
  { id: 20680, lustreless: 'wing', cat: "weapon" },  // Tanmogayi +1
  { id: 20604, lustreless: 'hide', cat: "weapon" },  // Ternion dagger +1
  { id: 20899, lustreless: 'hide', cat: "weapon" },  // Triska scythe +1
  { id: 21691, lustreless: 'hide', cat: "weapon" },  // Ushenzi +1
  { id: 21165, lustreless: 'hide', cat: "weapon" },  // Ababinili +1
  { id: 22058, lustreless: 'wing', cat: "weapon" },  // Contemplator +1
  { id: 21100, lustreless: 'hide', cat: "weapon" },  // Magesmasher +1
  { id: 21160, lustreless: 'hide', cat: "weapon" },  // Marin staff +1
  { id: 21163, lustreless: 'scale', cat: "weapon" }, // Pouwhenua +1
  { id: 21076, lustreless: 'wing', cat: "weapon" },  // Septoptic +1
  { id: 22267, lustreless: 'wing', cat: "weapon" },  // Antitail +1
  { id: 22121, lustreless: 'hide', cat: "weapon" },  // Imati +1
  { id: 21484, lustreless: 'wing', cat: "weapon" },  // Malison +1
  { id: 21223, lustreless: 'scale', cat: "weapon" }, // Mengado +1
  { id: 21220, lustreless: 'wing', cat: "weapon" },  // Paloma Bow +1
  { id: 21350, lustreless: 'scale', cat: "weapon" }, // Wingcutter +1
  { id: 27639, lustreless: 'hide', cat: "weapon" },  // Ajax +1
  { id: 27641, lustreless: 'hide', cat: "weapon" },  // Deliverance +1
  { id: 27637, lustreless: 'scale', cat: "weapon" }, // Evalach +1
  { id: 26402, lustreless: 'wing', cat: "weapon" },  // Forfend +1
  { id: 21417, lustreless: 'scale', cat: "weapon" }, // Refined grip +1
  { id: 21419, lustreless: 'hide', cat: "weapon" },  // Rigorous grip +1
  // Head
  { id: 26715, lustreless: 'hide', cat: "armor" },  // Adorned helm +1
  { id: 26787, lustreless: 'hide', cat: "armor" },  // Alhazen hat +1
  { id: 25602, lustreless: 'hide', cat: "armor" },  // Blistering sallet +1
  { id: 26785, lustreless: 'hide', cat: "armor" },  // Hike khat +1
  { id: 26710, lustreless: 'scale', cat: "armor" }, // Imp. Wing Hair. +1
  { id: 25636, lustreless: 'wing', cat: "armor" },  // Loess barbuta +1
  { id: 26732, lustreless: 'hide', cat: "armor" },  // Stinger helm +1
  // Body
  { id: 26943, lustreless: 'scale', cat: "armor" }, // Agony jerkin +1
  { id: 25681, lustreless: 'hide', cat: "armor" },  // Cohort cloak +1
  { id: 26871, lustreless: 'hide', cat: "armor" },  // Emet harness +1
  { id: 26873, lustreless: 'hide', cat: "armor" },  // Hime domaru +1
  { id: 26897, lustreless: 'scale', cat: "armor" }, // Lugra cloak +1
  { id: 25710, lustreless: 'wing', cat: "armor" },  // Obviat. Cuirass +1
  { id: 26869, lustreless: 'scale', cat: "armor" }, // Ros. Jaseran +1
  { id: 26888, lustreless: 'hide', cat: "armor" },  // Shomonjijoe +1
  { id: 25733, lustreless: 'wing', cat: "armor" },  // Tatena. Harama. +1
  // Hands
  { id: 27107, lustreless: 'hide', cat: "armor" },  // Asteria mitts +1
  { id: 27151, lustreless: 'hide', cat: "armor" },  // Gazu Bracelets +1
  { id: 27051, lustreless: 'hide', cat: "armor" },  // Kachi. Kote +1
  { id: 27109, lustreless: 'hide', cat: "armor" },  // Lamassu mitts +1
  { id: 27994, lustreless: 'scale', cat: "armor" }, // Macabre Gaunt. +1
  { id: 27996, lustreless: 'scale', cat: "armor" }, // Shigure tekko +1
  { id: 27149, lustreless: 'wing', cat: "armor" },  // Tatena. Gote +1
  // Legs
  { id: 28135, lustreless: 'scale', cat: "armor" }, // Assid. Pants +1
  { id: 28137, lustreless: 'scale', cat: "armor" }, // Augury cuisses +1
  { id: 25856, lustreless: 'wing', cat: "armor" },  // Tatena. Haidate +1
  { id: 27231, lustreless: 'scale', cat: "armor" }, // Zoar subligar +1
  // Feet
  { id: 27410, lustreless: 'scale', cat: "armor" }, // Hippo. Socks +1
  { id: 27408, lustreless: 'hide', cat: "armor" },  // Hygieia clogs +1
  { id: 28276, lustreless: 'hide', cat: "armor" },  // Jute boots +1
  { id: 28274, lustreless: 'scale', cat: "armor" }, // Regal pumps +1
  { id: 25924, lustreless: 'wing', cat: "armor" },  // Tatena. Sune. +1
  // Accessories (waist / ring / ear / back / neck)
  { id: 28430, lustreless: 'scale', cat: "accessory" }, // Acuity belt +1
  { id: 27561, lustreless: 'scale', cat: "accessory" }, // Apeile ring +1
  { id: 28487, lustreless: 'scale', cat: "accessory" }, // Arete del luna +1
  { id: 27620, lustreless: 'hide', cat: "accessory" },  // Aurist's cape +1
  { id: 27518, lustreless: 'hide', cat: "accessory" },  // Bathy choker +1
  { id: 10771, lustreless: 'hide', cat: "accessory" },  // Cacoethic ring +1
  { id: 28353, lustreless: 'scale', cat: "accessory" }, // Canto necklace +1
  { id: 27543, lustreless: 'wing', cat: "accessory" },  // Domin. Earring +1
  { id: 27610, lustreless: 'hide', cat: "accessory" },  // Fi follet cape +1
  { id: 10769, lustreless: 'scale', cat: "accessory" }, // Gelatinous ring +1
  { id: 21344, lustreless: 'hide', cat: "accessory" },  // Ghastly tathlum +1
  { id: 27602, lustreless: 'hide', cat: "accessory" },  // Ground. Mantle +1
  { id: 28491, lustreless: 'scale', cat: "accessory" }, // Handler's earring +1
  { id: 28413, lustreless: 'hide', cat: "accessory" },  // Kentarch belt +1
  { id: 26002, lustreless: 'wing', cat: "accessory" },  // Loricate torque +1
  { id: 28482, lustreless: 'scale', cat: "accessory" }, // Lugra earring +1
  { id: 27559, lustreless: 'hide', cat: "accessory" },  // Mephitas's ring +1
  { id: 27563, lustreless: 'scale', cat: "accessory" }, // Metamor. Ring +1
  { id: 28485, lustreless: 'scale', cat: "accessory" }, // Nourish. Earring +1
  { id: 27549, lustreless: 'hide', cat: "accessory" },  // Odnowa earring +1
  { id: 28428, lustreless: 'scale', cat: "accessory" }, // Sailfi belt +1
  { id: 28424, lustreless: 'scale', cat: "accessory" }, // Shinjutsu-no-obi +1
  { id: 22255, lustreless: 'hide', cat: "accessory" },  // Seeth. Bomblet +1
  { id: 27509, lustreless: 'scale', cat: "accessory" }, // Unmoving collar +1
  { id: 26022, lustreless: 'wing', cat: "accessory" },  // Vim torque +1
  { id: 27505, lustreless: 'hide', cat: "accessory" },  // Warder's charm +1
  { id: 27533, lustreless: 'hide', cat: "accessory" },  // Zwazo earring +1
];

export const UNITY_BY_ID: Map<number, UnityPiece> = new Map(UNITY_CATALOG.map((p) => [p.id, p]));
export const isUnityPiece = (id: number): boolean => UNITY_BY_ID.has(id);

// Lustreless items needed to take a piece from (rank, remainingRP-to-next-rank) up to targetRank. Finish the
// current rank (remainingRP / 5), then a full RANK_TOTAL for every rank in between. All thresholds and RP are
// multiples of 5, so this is exact with no overfeed.
export function lustrelessNeeded(rank: number, remainingRP: number, targetRank: number): number {
  if (rank >= targetRank || rank >= UNITY_MAX_RANK) return 0;
  let rp = Math.max(0, remainingRP);                 // finish the current rank
  for (let r = rank + 1; r < targetRank; r++) rp += RANK_TOTAL[r] ?? 0; // each full intermediate rank
  return Math.ceil(rp / RP_PER_LUSTRELESS);
}
