import { useSyncExternalStore } from 'react';
import { getCurrentWindow, currentMonitor, LogicalSize, PhysicalPosition } from '@tauri-apps/api/window';
import { inTauri } from './bridge';
import { getSettings } from './settings';

export type WinMode = 'regular' | 'compact';

const SIZES: Record<WinMode, { w: number; h: number }> = {
  regular: { w: 570, h: 850 },
  compact: { w: 460, h: 700 },
};

const KEY = 'alexandria-winmode';

function read(): WinMode {
  try {
    const m = localStorage.getItem(KEY);
    // 'expanded' (the old Fleet window) is retired; fall back to regular for anyone on it.
    if (m === 'regular' || m === 'compact') return m;
    if (localStorage.getItem('alexandria-compact') === '1') return 'compact';
  } catch { /* ignore */ }
  return 'regular';
}

let mode = read();
function applyDataset() { if (typeof document !== 'undefined') document.documentElement.dataset.winmode = mode; }
applyDataset();

export function getMode(): WinMode { return mode; }

export async function applyWindowSize(m: WinMode) {
  if (!inTauri) return;
  const s = SIZES[m];
  try { await getCurrentWindow().setSize(new LogicalSize(s.w, s.h)); } catch { /* ignore */ }
}

export async function watchMaximized(): Promise<() => void> {
  if (!inTauri) return () => {};
  const w = getCurrentWindow();
  const apply = async () => {
    try {
      const max = await w.isMaximized();
      if (typeof document === 'undefined') return;
      if (max) document.documentElement.dataset.maximized = '1';
      else delete document.documentElement.dataset.maximized;
    } catch { /* ignore */ }
  };
  void apply();
  try { return await w.onResized(() => { void apply(); }); } catch { return () => {}; }
}

const listeners = new Set<() => void>();
export function setMode(m: WinMode) {
  mode = m;
  applyDataset();
  try { localStorage.setItem(KEY, m); } catch { /* ignore */ }
  void applyWindowSize(m);
  listeners.forEach((l) => l());
}

export function useMode(): WinMode {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => mode, () => mode);
}

// The Library likes room (~1800x1000). When the libraryAutoResize setting is on, entering
// Library grows the window to that size and leaving restores the size it had before -- this
// IS the "resize in Library" behavior, and the setting is its on/off switch. Turning the
// setting off is how a user keeps a hand-sized or docked window untouched. The one case we
// never grow even when on is a MAXIMIZED window (growing it to a floating size would just
// un-maximize it); and on exit we skip the restore if the user resized or maximized the
// window while in Library, so a deliberate change made there always wins.
const LIBRARY_W = 1800, LIBRARY_H = 1000;
let savedLib: { w: number; h: number; pos: { x: number; y: number } | null; grownW: number; grownH: number } | null = null;

async function logicalSize(w: ReturnType<typeof getCurrentWindow>): Promise<{ w: number; h: number } | null> {
  try { const sf = await w.scaleFactor(); const sz = await w.innerSize(); return { w: sz.width / sf, h: sz.height / sf }; } catch { return null; }
}

export async function libraryWindowEnter() {
  if (!inTauri || !getSettings().libraryAutoResize) return;
  try {
    const w = getCurrentWindow();
    savedLib = null;
    if (await w.isMaximized()) return; // never resize a maximized window
    const cur = await logicalSize(w);
    const sw = cur?.w ?? SIZES[mode].w, sh = cur?.h ?? SIZES[mode].h;
    let tw = LIBRARY_W, th = LIBRARY_H;
    try {
      const mon = await currentMonitor();
      if (mon) {
        const sf = mon.scaleFactor || 1;
        tw = Math.min(tw, Math.round((mon.size.width / sf) * 0.96));
        th = Math.min(th, Math.round((mon.size.height / sf) * 0.92));
      }
    } catch { /* no monitor info */ }
    if (sw >= tw && sh >= th) return;
    let pos: { x: number; y: number } | null = null;
    try { const p = await w.outerPosition(); pos = { x: p.x, y: p.y }; } catch { /* ignore */ }
    const grownW = Math.max(sw, tw), grownH = Math.max(sh, th);
    savedLib = { w: sw, h: sh, pos, grownW, grownH };
    await w.setSize(new LogicalSize(grownW, grownH));
    try { await w.center(); } catch { /* ignore */ }
  } catch { /* ignore */ }
}

export async function libraryWindowExit() {
  if (!inTauri) return;
  const s = savedLib;
  savedLib = null;
  if (!s) return; // never grew on enter -> leave the window exactly as the user has it
  try {
    const w = getCurrentWindow();
    if (await w.isMaximized()) return; // user maximized while in Library -> keep it maximized
    const cur = await logicalSize(w);
    // User resized the window while in Library -> their choice, don't snap it back.
    if (cur && (Math.abs(cur.w - s.grownW) > 6 || Math.abs(cur.h - s.grownH) > 6)) return;
    await w.setSize(new LogicalSize(s.w, s.h));
    if (s.pos) { try { await w.setPosition(new PhysicalPosition(Math.round(s.pos.x), Math.round(s.pos.y))); } catch { /* ignore */ } }
  } catch { /* ignore */ }
}
