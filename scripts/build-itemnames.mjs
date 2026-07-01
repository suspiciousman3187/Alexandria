// Prebuilds the FULL item name index from Windower's res/items.lua, including
// non-auctionable items (No Auction flag) that ah_catalog.json deliberately
// omits. Used by rule/search comboboxes that must match any item by name.
//
//   node scripts/build-itemnames.mjs [pathToItems.lua]
//
// Output: public/item_names.json -> [{id,n,st}]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

const resDir = (process.argv[2] && dirname(process.argv[2])) || 'C:/Program Files (x86)/Windower Dev/res';
const itemsPath = process.argv[2] || join(resDir, 'items.lua');
const text = readFileSync(itemsPath, 'utf8');

const out = [];
const seen = new Set();
const re = /\[\d+\]\s*=\s*\{([^}]*)\}/g;
let m;
while ((m = re.exec(text))) {
  const body = m[1];
  const id = Number(body.match(/\bid=(\d+)/)?.[1] ?? 0);
  if (!id || seen.has(id)) continue;
  const en = body.match(/\ben="((?:\\.|[^"\\])*)"/)?.[1];
  if (!en || en === '.' || en === '') continue;
  const st = Number(body.match(/\bstack=(\d+)/)?.[1] ?? 1);
  out.push({ id, n: en.replace(/\\"/g, '"').replace(/\\\\/g, '\\'), st });
  seen.add(id);
}

out.sort((a, b) => a.id - b.id);
mkdirSync(join(repoRoot, 'public'), { recursive: true });
const dst = join(repoRoot, 'public', 'item_names.json');
writeFileSync(dst, JSON.stringify(out));
console.log(`Item names: ${out.length} items -> ${dst}`);
