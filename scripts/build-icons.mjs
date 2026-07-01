// Converts the extracted item-icon BMPs into a bundled PNG pack.
//
//   node scripts/build-icons.mjs [sourceAssetsDir]
//
// Source defaults to the live Windower addon's data/assets folder. Run the
// in-app "Extract All Icons" first so every item icon exists as a BMP, then run
// this to populate public/icons/<id>.png, which Vite bundles into the app.
//
// The extractor writes a fixed 32x32, 32bpp BGRA, bottom-up BMP with a 122-byte
// header (see icon_extractor.lua), so we decode it directly rather than guessing.

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

const DEFAULT_SRC = 'C:/Program Files (x86)/Windower Dev/addons/Alexandria/data/assets';
const src = process.argv[2] || DEFAULT_SRC;
const dst = join(repoRoot, 'public', 'icons');

const PIXELS = 122; // header size / pixel data offset
const SIZE = 32;

if (!existsSync(src)) {
  console.error(`Source folder not found: ${src}`);
  console.error('Run "Extract All Icons" in Alexandria first, or pass the assets dir as an argument.');
  process.exit(1);
}
mkdirSync(dst, { recursive: true });

function bmpToPng(buf) {
  if (buf.length < PIXELS + SIZE * SIZE * 4) return null;
  const png = new PNG({ width: SIZE, height: SIZE });
  for (let y = 0; y < SIZE; y++) {
    const srcRow = SIZE - 1 - y; // BMP rows are bottom-up
    for (let x = 0; x < SIZE; x++) {
      const s = PIXELS + (srcRow * SIZE + x) * 4;
      const d = (y * SIZE + x) * 4;
      png.data[d] = buf[s + 2];     // R
      png.data[d + 1] = buf[s + 1]; // G
      png.data[d + 2] = buf[s];     // B
      png.data[d + 3] = buf[s + 3]; // A
    }
  }
  return PNG.sync.write(png);
}

const files = readdirSync(src).filter((f) => /^icon_\d+\.bmp$/i.test(f));
let written = 0, skipped = 0, failed = 0;

for (const f of files) {
  const id = f.replace(/^icon_/i, '').replace(/\.bmp$/i, '');
  const outPath = join(dst, `${id}.png`);
  if (existsSync(outPath) && statSync(outPath).size > 0) { skipped++; continue; }
  try {
    const out = bmpToPng(readFileSync(join(src, f)));
    if (!out) { failed++; continue; }
    writeFileSync(outPath, out);
    written++;
    if (written % 1000 === 0) console.log(`  ${written} converted…`);
  } catch (e) {
    failed++;
  }
}

console.log(`Icon pack: ${written} written, ${skipped} already present, ${failed} failed. -> ${dst}`);
