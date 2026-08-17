import { invoke } from '@tauri-apps/api/core';
import { inTauri } from '../bridge';

export const JOB_CODES = ['WAR', 'MNK', 'WHM', 'BLM', 'RDM', 'THF', 'PLD', 'DRK', 'BST', 'BRD', 'RNG', 'SAM', 'NIN', 'DRG', 'SMN', 'BLU', 'COR', 'PUP', 'DNC', 'SCH', 'GEO', 'RUN'];
const JOB_LONG: Record<string, string> = {
  WAR: 'Warrior', MNK: 'Monk', WHM: 'White Mage', BLM: 'Black Mage', RDM: 'Red Mage', THF: 'Thief',
  PLD: 'Paladin', DRK: 'Dark Knight', BST: 'Beastmaster', BRD: 'Bard', RNG: 'Ranger', SAM: 'Samurai',
  NIN: 'Ninja', DRG: 'Dragoon', SMN: 'Summoner', BLU: 'Blue Mage', COR: 'Corsair', PUP: 'Puppetmaster',
  DNC: 'Dancer', SCH: 'Scholar', GEO: 'Geomancer', RUN: 'Rune Fencer',
};

// The Alexandria addon lives at <addons>/Alexandria; GearSwap data is a sibling at
// <addons>/GearSwap/data. Derive that so the folder is auto-detected without any input.
export function deriveGearswapData(addonDir: string): string {
  const dir = addonDir.replace(/[\\/]+$/, '');
  if (!dir) return '';
  const sep = dir.includes('/') && !dir.includes('\\') ? '/' : '\\';
  const parts = dir.split(/[\\/]/);
  parts.pop();
  return [...parts, 'GearSwap', 'data'].join(sep);
}

function sepOf(p: string): string { return p.includes('/') && !p.includes('\\') ? '/' : '\\'; }
function joinp(...parts: string[]): string {
  const s = sepOf(parts[0] || '\\');
  return parts.map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, '') : p.replace(/^[\\/]+|[\\/]+$/g, ''))).join(s);
}
// list_dir returns absolute file paths; reduce to the file name.
function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

async function tryList(path: string): Promise<string[] | null> {
  if (!inTauri) return null;
  try { return await invoke<string[]>('list_dir', { path }); } catch { return null; }
}

export async function readGearsetFile(path: string): Promise<string | null> {
  if (!inTauri) return null;
  try { return await invoke<string>('read_text_file', { path }); } catch { return null; }
}

// Mirrors GearSwap's search: directory outer loop, filename inner loop.
export async function findGearsetFile(base: string, char: string, job: string): Promise<string | null> {
  const j = job.toUpperCase();
  const long = JOB_LONG[j] ?? j;
  const dirs = [joinp(base, char), joinp(base, 'common'), joinp(base)];
  const names = [`${char}_${j}.lua`, `${char}-${j}.lua`, `${char}_${long}.lua`, `${char}-${long}.lua`, `${char}.lua`, `${j}.lua`, `${long}.lua`, 'default.lua'];
  for (const dir of dirs) {
    const entries = await tryList(dir);
    if (!entries) continue;
    const byName = new Map(entries.map((e) => [basename(e).toLowerCase(), e]));
    for (const nm of names) {
      const hit = byName.get(nm.toLowerCase());
      if (hit) return hit;
    }
  }
  return null;
}

function jobCodeFromStem(stem: string): string | null {
  const up = stem.toUpperCase();
  if (JOB_CODES.includes(up)) return up;
  const m = /[_-]([A-Za-z ]+)$/.exec(stem);
  if (m) {
    const tail = m[1].trim().toUpperCase();
    if (JOB_CODES.includes(tail)) return tail;
    const byLong = Object.entries(JOB_LONG).find(([, l]) => l.toUpperCase() === tail);
    if (byLong) return byLong[0];
  }
  return null;
}

// Job codes a character has gearset files for.
export async function listCharacterJobs(base: string, char: string): Promise<string[]> {
  const found = new Set<string>();
  for (const dir of [joinp(base, char), joinp(base)]) {
    const entries = await tryList(dir);
    if (!entries) continue;
    for (const e of entries) {
      const nm = basename(e);
      if (!nm.toLowerCase().endsWith('.lua')) continue;
      const code = jobCodeFromStem(nm.slice(0, -4));
      if (code) found.add(code);
    }
  }
  return JOB_CODES.filter((c) => found.has(c));
}
