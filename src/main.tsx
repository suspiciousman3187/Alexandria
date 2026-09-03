import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { appLocalDataDir } from '@tauri-apps/api/path';
import './styles.css';
import App from './App';
import PoolOverlay from './PoolOverlay';
import GearsetWindow from './GearsetWindow';
import { isPoolOverlay, isGearsetWindow } from './overlayWindow';
import { startDebugLog } from './debugLog';

const overlayMode = isPoolOverlay();
const gearsetMode = isGearsetWindow();
if (!overlayMode && !gearsetMode) startDebugLog(); // main window only -- rolling diagnostic log to disk
if (overlayMode) {
  document.documentElement.style.background = 'transparent';
  document.body.style.background = 'transparent';
}

let buffer = '';
async function logErr(kind: string, msg: string) {
  if (buffer.length > 8000) return;
  buffer += `[${kind}] ${msg}\n\n`;
  try {
    const base = (await appLocalDataDir()).replace(/[\\/]+$/, '');
    await invoke('write_text_file', { path: `${base}/error.log`, contents: buffer });
  } catch { /* ignore */ }
}
window.addEventListener('error', (e) => logErr('error', (e.error && e.error.stack) || e.message || String(e)));
window.addEventListener('unhandledrejection', (e) => logErr('reject', String((e.reason && e.reason.stack) || e.reason)));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {overlayMode ? <PoolOverlay /> : gearsetMode ? <GearsetWindow /> : <App />}
  </StrictMode>,
);
