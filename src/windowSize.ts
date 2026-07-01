import { useSyncExternalStore } from 'react';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import { inTauri } from './bridge';

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
