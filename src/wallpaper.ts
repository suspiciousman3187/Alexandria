import { useSyncExternalStore } from 'react';

const KEY = 'alexandria-wallpaper-bright';

function read(): number {
  try { const v = Number(localStorage.getItem(KEY)); return v >= 0.4 && v <= 1.6 ? v : 1.6; } catch { return 1.6; }
}

let bright = read();
function apply() { if (typeof document !== 'undefined') document.documentElement.style.setProperty('--wallpaper-bright', String(bright)); }
apply();

const listeners = new Set<() => void>();
export function setWallpaperBright(v: number) {
  bright = Math.max(0.4, Math.min(1.6, v));
  apply();
  try { localStorage.setItem(KEY, String(bright)); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}
export function useWallpaperBright(): number {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => bright, () => bright);
}

const PKEY = 'alexandria-panel-opacity';
function readPanel(): number {
  try { const v = Number(localStorage.getItem(PKEY)); return v >= 0.4 && v <= 1.2 ? v : 0.65; } catch { return 0.65; }
}
let panel = readPanel();
function applyPanel() { if (typeof document !== 'undefined') document.documentElement.style.setProperty('--panel-opacity', String(panel)); }
applyPanel();

const panelListeners = new Set<() => void>();
export function setPanelOpacity(v: number) {
  panel = Math.max(0.4, Math.min(1.2, v));
  applyPanel();
  try { localStorage.setItem(PKEY, String(panel)); } catch { /* ignore */ }
  panelListeners.forEach((l) => l());
}
export function usePanelOpacity(): number {
  return useSyncExternalStore((cb) => { panelListeners.add(cb); return () => panelListeners.delete(cb); }, () => panel, () => panel);
}
