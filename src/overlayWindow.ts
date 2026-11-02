import { useSyncExternalStore } from 'react';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { loadPoolGeom } from './poolGeom';
import { loadGearsetGeom } from './gearsetGeom';
import { setStickyPersisted } from './sticky';

const POOL_WAS_OPEN_KEY = 'pool.overlay.wasopen';
export const GEARSET_OPEN_KEY = 'gearsets.overlay.wasopen';

// Reactive open-state for the rail highlight. useStickyPersisted does NOT re-render on imperative
// setStickyPersisted writes (it reads once), so the live highlight needs its own subscribable store. We still
// mirror into the sticky so restore-on-launch keeps working.
let gearsetOpenState = false;
const gearsetOpenSubs = new Set<() => void>();
function setGearsetOpenState(v: boolean) {
  gearsetOpenState = v;
  setStickyPersisted(GEARSET_OPEN_KEY, v);
  gearsetOpenSubs.forEach((f) => f());
}
export function useGearsetOpen(): boolean {
  return useSyncExternalStore((cb) => { gearsetOpenSubs.add(cb); return () => gearsetOpenSubs.delete(cb); }, () => gearsetOpenState, () => gearsetOpenState);
}

export function isPoolOverlay(): boolean {
  try { return location.hash.replace(/^#/, '') === 'pool'; } catch { return false; }
}

// Remember whether the pool overlay is open so the next launch can restore it.
// Registered from the MAIN window (which stays alive), so the write survives the
// pool window being destroyed - a write scheduled inside the pool window would
// be lost when its webview tears down.
async function trackPoolOpenState() {
  setStickyPersisted(POOL_WAS_OPEN_KEY, true);
  try {
    const w = await WebviewWindow.getByLabel('pool');
    await w?.onCloseRequested(() => { setStickyPersisted(POOL_WAS_OPEN_KEY, false); });
  } catch { /* best effort */ }
}

export async function openPoolWindow() {
  try {
    const existing = await WebviewWindow.getByLabel('pool');
    if (existing) { await existing.show(); await existing.setFocus(); void trackPoolOpenState(); return; }
  } catch { /* not open yet */ }
  const g = await loadPoolGeom();
  const w = new WebviewWindow('pool', {
    url: 'index.html#pool',
    title: 'Treasure Pool',
    width: g?.w ?? 350,
    height: g?.h ?? 300,
    ...(g ? { x: g.x, y: g.y } : {}),
    minWidth: 260,
    minHeight: 120,
    decorations: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    shadow: false,
    visible: true,
  });
  void w.once('tauri://error', () => {});
  void w.once('tauri://created', () => { void trackPoolOpenState(); });
}

export function isGearsetWindow(): boolean {
  try { return location.hash.replace(/^#/, '') === 'gearsets'; } catch { return false; }
}

// Mirrors trackPoolOpenState: remember open/closed from the MAIN window (which stays alive) so the rail
// highlight survives the gearsets window being destroyed. One onCloseRequested registration per open, exactly
// like the pool overlay.
async function trackGearsetOpenState() {
  setGearsetOpenState(true);
  try {
    const w = await WebviewWindow.getByLabel('gearsets');
    await w?.onCloseRequested(() => { setGearsetOpenState(false); });
  } catch { /* best effort */ }
}

export async function openGearsetWindow() {
  try {
    const existing = await WebviewWindow.getByLabel('gearsets');
    if (existing) { await existing.show(); await existing.setFocus(); void trackGearsetOpenState(); return; }
  } catch { /* not open yet */ }
  const g = await loadGearsetGeom();
  const w = new WebviewWindow('gearsets', {
    url: 'index.html#gearsets',
    title: 'Gearsets',
    width: g?.w ?? 1200,
    height: g?.h ?? 850,
    ...(g ? { x: g.x, y: g.y } : {}),
    minWidth: 1040,
    minHeight: 640,
    decorations: false,
    transparent: false,
    resizable: true,
    skipTaskbar: false,
    visible: true,
  });
  void w.once('tauri://error', () => {});
  void w.once('tauri://created', () => { void trackGearsetOpenState(); });
}

// Rail toggle: open the window if it's closed, close it if it's open. onCloseRequested flips the sticky back.
export async function toggleGearsetWindow() {
  try {
    const existing = await WebviewWindow.getByLabel('gearsets');
    if (existing) { await existing.close(); return; }
  } catch { /* not open */ }
  await openGearsetWindow();
}
