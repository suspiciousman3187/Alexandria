export const JOBS: { code: string; label: string }[] = [
  { code: 'war', label: 'WAR' }, { code: 'mnk', label: 'MNK' }, { code: 'whm', label: 'WHM' },
  { code: 'blm', label: 'BLM' }, { code: 'rdm', label: 'RDM' }, { code: 'thf', label: 'THF' },
  { code: 'pld', label: 'PLD' }, { code: 'drk', label: 'DRK' }, { code: 'bst', label: 'BST' },
  { code: 'brd', label: 'BRD' }, { code: 'rng', label: 'RNG' }, { code: 'sam', label: 'SAM' },
  { code: 'nin', label: 'NIN' }, { code: 'drg', label: 'DRG' }, { code: 'smn', label: 'SMN' },
  { code: 'blu', label: 'BLU' }, { code: 'cor', label: 'COR' }, { code: 'pup', label: 'PUP' },
  { code: 'dnc', label: 'DNC' }, { code: 'sch', label: 'SCH' }, { code: 'geo', label: 'GEO' },
  { code: 'run', label: 'RUN' },
];

export const JOB_TO_CAPE: Record<string, string> = {
  war: "Cichol's Mantle", mnk: "Segomo's Mantle", whm: "Alaunus's Cape", blm: "Taranus's Cape",
  rdm: "Sucellos's Cape", thf: "Toutatis's Cape", pld: "Rudianos's Mantle", drk: "Ankou's Mantle",
  bst: "Artio's Mantle", brd: "Intarabus's Cape", rng: "Belenus's Cape", sam: "Smertrios's Mantle",
  nin: "Andartia's Mantle", drg: "Brigantia's Mantle", smn: "Campestres's Cape", blu: "Rosmerta's Cape",
  cor: "Camulus's Mantle", pup: "Visucius's Mantle", dnc: "Senuna's Mantle", sch: "Lugh's Cape",
  geo: "Nantosuelta's Cape", run: "Ogma's cape",
};

export const MATERIALS = ['Thread', 'Dust', 'Sap', 'Dye', 'Resin'] as const;

export const AUG_PATHS: Record<string, string[]> = {
  Thread: ['HP', 'MP', 'STR', 'DEX', 'VIT', 'AGI', 'INT', 'MND', 'CHR', 'PetMelee', 'PetMagic'],
  Dust: ['Acc/Atk', 'RAcc/RAtk', 'MAcc/MDmg', 'Eva/MEva'],
  Sap: ['WSD', 'CritRate', 'STP', 'DoubleAttack', 'Haste', 'DW', 'Enmity+', 'Enmity-', 'Snapshot', 'MAB', 'FC', 'CurePotency', 'WaltzPotency', 'PetRegen', 'PetHaste'],
  Dye: ['HP', 'MP', 'STR', 'DEX', 'VIT', 'AGI', 'INT', 'MND', 'CHR', 'Acc', 'Atk', 'Racc', 'Ratk', 'MAcc', 'MDmg', 'Eva', 'MEva', 'PetAcc', 'PetAtk', 'PetMAcc', 'PetMDmg'],
  Resin: ['DEF', 'EvaR', 'MEvaR', 'PDT', 'MDT', 'DT', 'Regen', 'Counter', 'BlockRate', 'ParryRate', 'ResistAll', 'CastInt', 'PetPDT', 'PetMDT', 'PetDT', 'PetRegenR'],
};

export const CAPE_MAX: Record<string, number> = {
  Thread: 20, Dust: 20, Sap: 10, Dye: 10, Resin: 5,
};

export const AUG_PATH_LABELS: Record<string, string> = {
  PetMelee: 'Pet: Accuracy / Attack', PetMagic: 'Pet: Magic Acc / Magic Atk',
  'Acc/Atk': 'Accuracy / Attack', 'RAcc/RAtk': 'Ranged Acc / Ranged Atk',
  'MAcc/MDmg': 'Magic Acc / Magic Dmg', 'Eva/MEva': 'Evasion / Magic Evasion',
  WSD: 'Weapon Skill Damage', CritRate: 'Critical Hit Rate', STP: 'Store TP',
  DoubleAttack: 'Double Attack', DW: 'Dual Wield', 'Enmity+': 'Enmity +', 'Enmity-': 'Enmity -',
  MAB: 'Magic Attack Bonus', FC: 'Fast Cast', CurePotency: 'Cure Potency', WaltzPotency: 'Waltz Potency',
  PetRegen: 'Pet: Regen', PetHaste: 'Pet: Haste',
  Acc: 'Accuracy', Atk: 'Attack', Racc: 'Ranged Accuracy', Ratk: 'Ranged Attack',
  MAcc: 'Magic Accuracy', MDmg: 'Magic Damage', Eva: 'Evasion', MEva: 'Magic Evasion',
  PetAcc: 'Pet: Accuracy', PetAtk: 'Pet: Attack', PetMAcc: 'Pet: Magic Accuracy', PetMDmg: 'Pet: Magic Damage',
  DEF: 'Defense', EvaR: 'Evasion', MEvaR: 'Magic Evasion', PDT: 'Physical Damage Taken',
  MDT: 'Magic Damage Taken', DT: 'Damage Taken', Regen: 'Regen', Counter: 'Counter',
  BlockRate: 'Block Rate', ParryRate: 'Parry Rate', ResistAll: 'Resist All Status Ailments',
  CastInt: 'Spell Interruption Rate Down', PetPDT: 'Pet: Physical Damage Taken',
  PetMDT: 'Pet: Magic Damage Taken', PetDT: 'Pet: Damage Taken', PetRegenR: 'Pet: Regen',
};
export const augPathLabel = (p: string) => AUG_PATH_LABELS[p] ?? p;

export const STYLES = ['Melee', 'Ranged', 'Magic', 'Familiar', 'Healing', 'Techniques'] as const;

export const SKIRMISH_WEAPON: string[] = [
  "Aedold", "Aedold +1", "Aedold +2", "Bocluamni", "Bocluamni +1", "Bocluamni +2",
  "Crobaci", "Crobaci +1", "Crobaci +2", "Faizzeer", "Faizzeer +1", "Faizzeer +2",
  "Hgafircian", "Hgafircian +1", "Hgafircian +2", "Iclamar", "Iclamar +1", "Iclamar +2",
  "Iizamal", "Iizamal +1", "Iizamal +2", "Iztaasu", "Iztaasu +1", "Iztaasu +2",
  "Kannakiri", "Kannakiri +1", "Kannakiri +2", "Lehbrailg", "Lehbrailg +1", "Lehbrailg +2",
  "Leisilonu", "Leisilonu +1", "Leisilonu +2", "Ninzas", "Ninzas +1", "Ninzas +2",
  "Qatsunoci", "Qatsunoci +1", "Qatsunoci +2", "Shichishito", "Shichishito +1", "Shichishito +2",
  "Uffrat", "Uffrat +1", "Uffrat +2",
];

export const SKIRMISH_ARMOR: string[] = [
  "Beatific Shield", "Beatific Shield +1", "Cizin Breeches", "Cizin Breeches +1", "Cizin Greaves",
  "Cizin Greaves +1", "Cizin Helm", "Cizin Helm +1", "Cizin Mail", "Cizin Mail +1", "Cizin Mufflers",
  "Cizin Mufflers +1", "Gendewitha Bliaut", "Gende. Bliaut +1", "Gende. Caubeen",
  "Gende. Caubeen +1", "Gendewitha Gages", "Gende. Gages +1", "Gende. Galoshes",
  "Gende. Galosh. +1", "Gendewitha Spats", "Gende. Spats +1", "Hag. Sabots +1", "Hagondes Coat",
  "Hagondes Coat +1", "Hagondes Cuffs", "Hagondes Cuffs +1", "Hagondes Hat", "Hagondes Hat +1",
  "Hagondes Pants", "Hagondes Pants +1", "Hagondes Sabots", "Iuitl Gaiters", "Iuitl Gaiters +1",
  "Iuitl Headgear", "Iuitl Headgear +1", "Iuitl Tights", "Iuitl Tights +1", "Iuitl Vest", "Iuitl Vest +1",
  "Iuitl Wristbands", "Iuitl Wristbands +1", "Otronif Boots", "Otronif Boots +1", "Otronif Brais",
  "Otronif Brais +1", "Otronif Gloves", "Otronif Gloves +1", "Otronif Harness", "Otro. Harness +1",
  "Otronif Mask", "Otronif Mask +1",
];

export const ALLUVION_SKIRMISH_WEAPON: string[] = [
  "Claidheamh Soluis", "Doomsday", "Inanna", "Ipetam", "Izuna", "Keraunos", "Kumbhakarna", "Linos",
  "Macbain", "Nehushtan", "Nenekirimaru", "Ohrmazd", "Olyndicus", "Phaosphaelia", "Svalinn", "Svarga",
];

export const ALLUVION_SKIRMISH_ARMOR: string[] = [
  "Acro Breeches", "Acro Gauntlets", "Acro Helm", "Acro Leggings", "Acro Surcoat", "Helios Band",
  "Helios Boots", "Helios Gloves", "Helios Jacket", "Helios Spats", "Taeon Boots", "Taeon Chapeau",
  "Taeon Gloves", "Taeon Tabard", "Taeon Tights", "Telchine Braconi", "Telchine Cap", "Telchine Chas.",
  "Telchine Gloves", "Telchine Pigaches", "Yorium Barbuta", "Yorium Cuirass", "Yorium Cuisses",
  "Yorium Gauntlets", "Yorium Sabatons",
];

export const GEAS_FETE_WEAPON: string[] = [
  "Aganoshe", "Colada", "Condemners", "Digirbalag", "Gada", "Grioavolr", "Holliday", "Kanaria",
  "Obschine", "Reienkyo", "Skinflayer", "Teller", "Umaru", "Zulfiqar",
];

export const GEAS_FETE_ARMOR: string[] = [
  "Chironic Doublet", "Chironic Gloves", "Chironic Hat", "Chironic Hose", "Chironic Slippers",
  "Herculean Boots", "Herculean Gloves", "Herculean Helm", "Herculean Trousers", "Herculean Vest",
  "Merlinic Crackows", "Merlinic Dastanas", "Merlinic Hood", "Merlinic Jubbah", "Merlinic Shalwar",
  "Odyss. Chestplate", "Odyssean Cuisses", "Odyssean Gauntlets", "Odyssean Greaves", "Odyssean Helm",
  "Valorous Greaves", "Valorous Hose", "Valorous Mail", "Valorous Mask", "Valorous Mitts",
];

export const CAPE_GEAR: string[] = [
  "Anchoret's Mantle", "Bane Cape", "Bookworm's Cape", "Canny Cape", "Conveyance Cape", "Cornflower Cape",
  "Dispersal Mantle", "Evasionist's Cape", "Ghostfyre Cape", "Gunslinger's Cape", "Lifestream Cape",
  "Lutian Cape", "Mauler's Mantle", "Mending Cape", "Niht Mantle", "Pastoralist's Mantle", "Rhapsode's Cape",
  "Takaha Mantle", "Toetapper Mantle", "Updraft Mantle", "Weard Mantle", "Yokaze Mantle",
];

export const CRYSTAL_MAT: string[] = ["Refractive Crystal"];

export const STONES_SKIRMISH: string[] = [
  "Ghastly Stone", "Ghastly Stone +1", "Ghastly Stone +2", "Verdigris Stone", "Verdigris Stone +1",
  "Verdigris Stone +2", "Wailing Stone", "Wailing stone +1", "Wailing stone +2",
];

export const STONES_ALLUVION: string[] = [
  "Duskdim Stone", "Duskdim Stone +1", "Duskdim Stone +2", "Duskorb Stone", "Duskorb Stone +1",
  "Duskorb Stone +2", "Duskslit Stone", "Duskslit Stone +1", "Duskslit Stone +2", "Dusktip Stone",
  "Dusktip Stone +1", "Dusktip Stone +2", "Leafdim Stone", "Leafdim Stone +1", "Leafdim Stone +2",
  "Leaforb Stone", "Leaforb Stone +1", "Leaforb Stone +2", "Leafslit Stone", "Leafslit Stone +1",
  "Leafslit Stone +2", "Leaftip Stone", "Leaftip Stone +1", "Leaftip Stone +2", "Snowdim Stone",
  "Snowdim Stone +1", "Snowdim Stone +2", "Snoworb Stone", "Snoworb Stone +1", "Snoworb Stone +2",
  "Snowslit Stone", "Snowslit Stone +1", "Snowslit Stone +2", "Snowtip Stone", "Snowtip Stone +1",
  "Snowtip Stone +2",
];

export const STONES_GEAS: string[] = ["Dark Matter", "Fern Stone", "Pellucid Stone", "Taupe Stone"];

export type TradeType = { id: string; label: string; mode: string; gear: string[]; material: string[]; style?: boolean };

export const TRADE_TYPES: Record<string, TradeType> = {
  'Skirmish Weapon': { id: 'Skirmish Weapon', label: 'Weapon', mode: 'Skirmish', gear: SKIRMISH_WEAPON, material: STONES_SKIRMISH },
  'Skirmish Armor': { id: 'Skirmish Armor', label: 'Armor', mode: 'Skirmish', gear: SKIRMISH_ARMOR, material: STONES_SKIRMISH },
  'Alluvion Skirmish Weapon': { id: 'Alluvion Skirmish Weapon', label: 'Alluvion Weapon', mode: 'Skirmish', gear: ALLUVION_SKIRMISH_WEAPON, material: STONES_ALLUVION },
  'Alluvion Skirmish Armor': { id: 'Alluvion Skirmish Armor', label: 'Alluvion Armor', mode: 'Skirmish', gear: ALLUVION_SKIRMISH_ARMOR, material: STONES_ALLUVION },
  'Geas Fete Weapon': { id: 'Geas Fete Weapon', label: 'Weapon', mode: 'Geas Fete', gear: GEAS_FETE_WEAPON, material: STONES_GEAS, style: true },
  'Geas Fete Armor': { id: 'Geas Fete Armor', label: 'Armor', mode: 'Geas Fete', gear: GEAS_FETE_ARMOR, material: STONES_GEAS, style: true },
  'Cape': { id: 'Cape', label: 'Cape', mode: 'Cape', gear: CAPE_GEAR, material: CRYSTAL_MAT },
};

export const VIEW_TRADE_TYPES: Record<string, string[]> = {
  skirmish: ['Skirmish Weapon', 'Skirmish Armor', 'Alluvion Skirmish Weapon', 'Alluvion Skirmish Armor'],
  reive: ['Cape'],
  geasfete: ['Geas Fete Weapon', 'Geas Fete Armor'],
};

export const AUG_STATS: string[] = [
  "Accuracy", "Accuracy and Attack", "AGI", "All Songs", "Archery Skill", "Attack",
  "Avatar Perpetuation Cost", "Avatar: Magic Attack Bonus", "Axe Skill", "Barrage", "Blood Boon",
  "Blood Pact Ability Delay", "Blood Pact Ability Delay II", "Blood Pact Damage", "Blue Magic Skill",
  "Breath Damage Taken", "Call Beast Ability Delay", "Cap. Point", "Chance of Successful Block", "Charm",
  "CHR", "Club Skill", "Conserve MP", "Conserve TP", "Counter", "Critical Hit Damage", "Critical Hit Rate",
  "Cure Potency", "Cure Spellcasting Time", "Dagger Skill", "Damage Taken", "Dark Magic Skill", "DEF",
  "Delay", "DEX", "Divine Magic Skill", "DMG", "Double Attack", "Drain and Aspir Potency", "Dual Wield",
  "Elemental Magic Skill", "Elemental Siphon", "Embolden", "Enemy Critical Hit Rate", "Enfeebling Magic Skill",
  "Enh. Mag. Eff. Dur.", "Enhances Souleater Effect", "Enhancing Magic Skill", "Enmity", "Evasion",
  "Fast Cast", "Geomancy Skill", "Gilfinder", "Great Axe Skill", "Great Katana Skill", "Great Sword Skill",
  "Hand-to-Hand Skill", "Handbell Skill", "Haste", "Healing Magic Skill", "Helix Eff. Dur.", "HP",
  "HP and MP", "HP Recovered While Healing", "Indi. Eff. Dur.", "INT", "INT and MND", "Katana Skill",
  "Kick Attacks", "Latent Effect: Refresh", "Latent Effect: Regain", "Magic Accuracy",
  "Magic Accuracy and Magic Attack Bonus", "Magic Attack Bonus", "Magic Burst Damage",
  "Magic Critical Hit Damage", "Magic Critical Hit Rate", "Magic Damage", "Magic Damage Taken",
  "Magic Defense Bonus", "Magic Evasion", "Magic Skill", "Marksmanship Skill", "Martial Arts",
  "Meditate Eff. Dur.", "Melee Skill", "MND", "MP", "MP Recovered While Healing", "Ninja Tool Expertise",
  "Ninjutsu Skill", "Occ. Inc. Resist. To Stat. Ailments", "Occ. Maximizes Magic Accuracy",
  "Occ. Quickens Spellcasting", "Occult Acumen", "Pet: Accuracy", "Pet: Accuracy and Pet: Ranged Accuracy",
  "Pet: AGI", "Pet: Attack", "Pet: Attack and Pet: Ranged Attack", "Pet: Breath", "Pet: CHR",
  "Pet: Critical Hit Rate", "Pet: Damage Taken", "Pet: DEF", "Pet: DEX", "Pet: Double Attack",
  "Pet: Double Attack and Critical Hit Rate", "Pet: Enemy Critical Hit Rate", "Pet: Enmity", "Pet: Evasion",
  "Pet: Haste", "Pet: INT", "Pet: Magic Accuracy", "Pet: Magic Attack Bonus", "Pet: Magic Damage",
  "Pet: Magic Defense Bonus", "Pet: Magic Evasion", "Pet: MND", "Pet: Physical Damage Taken",
  "Pet: Ranged Accuracy", "Pet: Ranged Attack", "Pet: Regen", "Pet: Store TP", "Pet: STR", "Pet: Subtle Blow",
  "Pet: TP Bonus", "Pet: VIT", "Phalanx", "Phantom Roll Ability Delay", "Physical Damage Taken",
  "Polearm Skill", "Potency of Cure Effect Received", "Quadruple Attack", "Quick Draw Ability Delay",
  "Ranged Accuracy", "Ranged Accuracy and Ranged Attack", "Ranged Attack", "Ranged Skill", "Rapid Shot",
  "Recycle", "Refresh", "Regen", "Regen Potency", "Repair Potency", "Resist Bind", "Resist Blind",
  "Resist Charm", "Resist Curse", "Resist Gravity", "Resist Paralyze", "Resist Petrify", "Resist Poison",
  "Resist Silence", "Resist Sleep", "Resist Slow", "Resist Stun", "Resist Virus", "Reverse Flourish",
  "Save TP", "Scythe Skill", "Shield Mastery", "Shield Skill", "Sic and Ready Ability Delay", "Singing Skill",
  "Skillchain Damage", "Slow", "Snapshot", "Song Recast Delay", "Song Spellcasting Time",
  "Spell Interruption Rate Down", "Staff Skill", "Store TP", "STR", "STR and AGI", "STR and CHR",
  "STR and DEX", "STR and VIT", "String Instrument Skill", "Subtle Blow", "Summoning Magic Skill",
  "Sword Enhancement Spell Damage", "Sword Skill", "Throwing Skill", "TP Bonus", "Treasure Hunter",
  "Triple Attack", "VIT", "Waltz Ability Delay", "Waltz Potency", "Waltz TP Cost", "Weapon Skill Accuracy",
  "Weapon Skill Damage", "Wind Instrument Skill", "Zanshin",
];
