import { invoke } from '@tauri-apps/api/core';
import { appDataPath, inTauri } from './bridge';

// Persisted position + size (logical px) of the pop-out Treasure Pool window. Kept in its own
// file so it survives closing/reopening the window and full app restarts, and is readable from
// both the main window (which opens the pool) and the pool window itself (which saves it).
export type PoolGeom = { x: number; y: number; w: number; h: number };

const FILE = 'pool_geom.json';

export async function loadPoolGeom(): Promise<PoolGeom | null> {
  if (!inTauri) return null;
  try {
    const txt = await invoke<string>('read_text_file', { path: await appDataPath(FILE) });
    const g = JSON.parse(txt);
    if (g && [g.x, g.y, g.w, g.h].every((n) => typeof n === 'number' && isFinite(n)) && g.w > 0 && g.h > 0) return g;
  } catch { /* none saved yet */ }
  return null;
}

export async function savePoolGeom(g: PoolGeom): Promise<void> {
  if (!inTauri) return;
  try { await invoke('write_text_file', { path: await appDataPath(FILE), contents: JSON.stringify(g) }); } catch { /* ignore */ }
}
