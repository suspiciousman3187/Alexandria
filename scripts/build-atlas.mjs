// Packs the auctionable item icons into a few sprite-sheet atlases so the UI
// loads ~3 images once instead of fetching 11k individual PNGs through the
// webview. Each icon is a fixed 32x32 cell; the client positions it by index
// math (no per-icon lookup or request).
//
//   node scripts/build-atlas.mjs
//
// Reads public/icons/<id>.png (from build:icons) + public/ah_catalog.json,
// writes public/atlas/cat_<k>.png + public/atlas/cat_index.json.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const iconsDir = join(root, 'public', 'icons');
const outDir = join(root, 'public', 'atlas');

const CELL = 32;
const COLS = 32;
const PER = COLS * COLS;
const DIM = COLS * CELL;

if (!existsSync(iconsDir)) {
  console.error(`No icon PNGs at ${iconsDir}. Run "npm run build:icons" first.`);
  process.exit(1);
}

const ids = readdirSync(iconsDir)
  .filter((f) => f.endsWith('.png'))
  .map((f) => parseInt(f.slice(0, -4), 10))
  .filter((id) => Number.isFinite(id) && id > 0)
  .sort((a, b) => a - b);

mkdirSync(outDir, { recursive: true });
const sheets = Math.ceil(ids.length / PER);

for (let k = 0; k < sheets; k++) {
  const sheet = new PNG({ width: DIM, height: DIM });
  const slice = ids.slice(k * PER, (k + 1) * PER);
  for (let i = 0; i < slice.length; i++) {
    const icon = PNG.sync.read(readFileSync(join(iconsDir, `${slice[i]}.png`)));
    if (icon.width !== CELL || icon.height !== CELL) continue;
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const dx = col * CELL;
    const dy = row * CELL;
    for (let y = 0; y < CELL; y++) {
      const src = y * CELL * 4;
      const dst = ((dy + y) * DIM + dx) * 4;
      icon.data.copy(sheet.data, dst, src, src + CELL * 4);
    }
  }
  writeFileSync(join(outDir, `cat_${k}.png`), PNG.sync.write(sheet));
  console.log(`  cat_${k}.png (${slice.length} icons)`);
}

writeFileSync(join(outDir, 'cat_index.json'), JSON.stringify(ids));
console.log(`Atlas: ${ids.length} icons across ${sheets} sheet(s) -> ${outDir}`);
