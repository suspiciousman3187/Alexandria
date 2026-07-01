// Prebuilds the auctionable item catalog from Windower's res/items.lua so the
// app ships with it and never needs the in-game addon stream on first use.
//
//   node scripts/build-catalog.mjs [pathToItems.lua]
//
// Output: public/ah_catalog.json (same shape the addon streams: {id,n,cat,lvl,j,st}).
// The in-app "Refresh From Game" stays available for game updates / corruption.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

const JOBS = ['WAR', 'MNK', 'WHM', 'BLM', 'RDM', 'THF', 'PLD', 'DRK', 'BST', 'BRD', 'RNG', 'SAM', 'NIN', 'DRG', 'SMN', 'BLU', 'COR', 'PUP', 'DNC', 'SCH', 'GEO', 'RUN'];
const NO_AUCTION = 0x40; // res flag bit 0x0040 = "No Auction"

const resDir = (process.argv[2] && dirname(process.argv[2])) || 'C:/Program Files (x86)/Windower Dev/res';
const itemsPath = process.argv[2] || join(resDir, 'items.lua');
const descPath = join(resDir, 'item_descriptions.lua');
const text = readFileSync(itemsPath, 'utf8');

// Item id -> AH category id (Auctioneer's itemIds.lua, bundled into the repo).
const acById = new Map();
try {
  const acText = readFileSync(join(__dirname, 'data', 'ah_item_categories.lua'), 'utf8');
  const acre = /\{\s*(\d+)\s*,\s*(\d+)\s*\}/g;
  let a;
  while ((a = acre.exec(acText))) acById.set(Number(a[1]), Number(a[2]));
} catch (e) {
  console.warn(`AH category map not found, items will be uncategorized: ${e.message}`);
}

const out = [];
const ids = new Set();
const re = /\[\d+\]\s*=\s*\{([^}]*)\}/g;
let m;
while ((m = re.exec(text))) {
  const body = m[1];
  const id = Number(body.match(/\bid=(\d+)/)?.[1] ?? 0);
  if (!id) continue;
  const flags = Number(body.match(/\bflags=(\d+)/)?.[1] ?? 0);
  if (flags & NO_AUCTION) continue;
  const en = body.match(/\ben="((?:\\.|[^"\\])*)"/)?.[1];
  if (!en) continue;
  const cat = body.match(/\bcategory="([^"]*)"/)?.[1] ?? '';
  const lvl = Number(body.match(/\blevel=(\d+)/)?.[1] ?? 0);
  const il = Number(body.match(/\bitem_level=(\d+)/)?.[1] ?? 0);
  const st = Number(body.match(/\bstack=(\d+)/)?.[1] ?? 1);
  const jobsNum = Number(body.match(/\bjobs=(\d+)/)?.[1] ?? 0);
  const j = [];
  for (let i = 0; i < JOBS.length; i++) if ((jobsNum >> (i + 1)) & 1) j.push(JOBS[i]);
  out.push({ id, n: en, cat, lvl, ...(il ? { il } : {}), j, st, ac: acById.get(id) ?? 0 });
  ids.add(id);
}

out.sort((a, b) => a.id - b.id);
mkdirSync(join(repoRoot, 'public'), { recursive: true });
const dst = join(repoRoot, 'public', 'ah_catalog.json');
writeFileSync(dst, JSON.stringify(out));
console.log(`Catalog: ${out.length} auctionable items -> ${dst}`);

// Descriptions for the same items (separate, lazy-loaded file).
let descCount = 0;
try {
  const dtext = readFileSync(descPath, 'utf8');
  const desc = {};
  const dre = /\[(\d+)\]\s*=\s*\{([^}]*)\}/g;
  let d;
  while ((d = dre.exec(dtext))) {
    const id = Number(d[1]);
    const en = d[2].match(/\ben="((?:\\.|[^"\\])*)"/)?.[1];
    if (!en) continue;
    desc[id] = en.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
    descCount++;
  }
  const ddst = join(repoRoot, 'public', 'ah_descriptions.json');
  writeFileSync(ddst, JSON.stringify(desc));
  console.log(`Descriptions: ${descCount} -> ${ddst}`);
} catch (e) {
  console.warn(`Descriptions skipped (${descPath} not found): ${e.message}`);
}
