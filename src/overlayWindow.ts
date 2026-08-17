import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { loadPoolGeom } from './poolGeom';

export function isPoolOverlay(): boolean {
  try { return location.hash.replace(/^#/, '') === 'pool'; } catch { return false; }
}

export async function openPoolWindow() {
  try {
    const existing = await WebviewWindow.getByLabel('pool');
    if (existing) { await existing.show(); await existing.setFocus(); return; }
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
}

export function isGearsetWindow(): boolean {
  try { return location.hash.replace(/^#/, '') === 'gearsets'; } catch { return false; }
}

export async function openGearsetWindow() {
  try {
    const existing = await WebviewWindow.getByLabel('gearsets');
    if (existing) { await existing.show(); await existing.setFocus(); return; }
  } catch { /* not open yet */ }
  const w = new WebviewWindow('gearsets', {
    url: 'index.html#gearsets',
    title: 'Gearsets',
    width: 1040,
    height: 680,
    minWidth: 840,
    minHeight: 540,
    decorations: false,
    transparent: false,
    resizable: true,
    skipTaskbar: false,
    visible: true,
  });
  void w.once('tauri://error', () => {});
}
