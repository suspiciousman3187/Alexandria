import { useMemo, type PointerEvent as RPointerEvent } from 'react';
import { MotionConfig } from 'motion/react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ItemHoverProvider } from './ItemTooltip';
import { inTauri } from './bridge';
import GearsetView from './GearsetView';

type ResizeDir = 'NorthWest' | 'North' | 'NorthEast' | 'East' | 'SouthEast' | 'South' | 'SouthWest' | 'West';
const CTRL = 'w-8 h-8 grid place-items-center rounded text-fg-4 hover:bg-line hover:text-fg-2 transition-colors';

export default function GearsetWindow() {
  const win = useMemo(() => (inTauri ? getCurrentWindow() : null), []);
  const startResize = (dir: ResizeDir) => (e: RPointerEvent) => {
    if (!win) return;
    e.preventDefault();
    e.stopPropagation();
    win.startResizeDragging(dir).catch(() => {});
  };
  return (
    <MotionConfig reducedMotion="user">
      <ItemHoverProvider>
        <div className="relative w-screen h-screen overflow-hidden bg-[var(--color-bg)] text-fg-2">
          {inTauri && <>
            <div onPointerDown={startResize('North')} className="absolute top-0 left-3 right-3 h-1 cursor-n-resize z-30" />
            <div onPointerDown={startResize('South')} className="absolute bottom-0 left-3 right-3 h-1 cursor-s-resize z-30" />
            <div onPointerDown={startResize('West')} className="absolute top-3 bottom-3 left-0 w-1 cursor-w-resize z-30" />
            <div onPointerDown={startResize('East')} className="absolute top-3 bottom-3 right-0 w-1 cursor-e-resize z-30" />
            <div onPointerDown={startResize('NorthWest')} className="absolute top-0 left-0 w-3 h-3 cursor-nw-resize z-30" />
            <div onPointerDown={startResize('NorthEast')} className="absolute top-0 right-0 w-3 h-3 cursor-ne-resize z-30" />
            <div onPointerDown={startResize('SouthWest')} className="absolute bottom-0 left-0 w-3 h-3 cursor-sw-resize z-30" />
            <div onPointerDown={startResize('SouthEast')} className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize z-30" />
          </>}
          <div className="h-full flex flex-col">
            <div data-tauri-drag-region className="shrink-0 flex items-center gap-2 pl-3.5 pr-1.5 h-9 border-b border-line select-none">
              <span data-tauri-drag-region className="w-[3px] h-3.5 rounded bg-accent shrink-0" />
              <span data-tauri-drag-region className="flex-1 h-full flex items-center text-[11px] font-extrabold tracking-[0.16em] text-accent cursor-move">GEARSETS</span>
              <button onClick={() => void win?.minimize()} aria-label="Minimize" title="Minimize" className={CTRL}>
                <svg width="14" height="14" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2.5 9.5h7" /></svg>
              </button>
              <button onClick={() => void win?.toggleMaximize()} aria-label="Maximize" title="Maximize" className={CTRL}>
                <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="2.3" y="2.3" width="7.4" height="7.4" rx="1" /></svg>
              </button>
              <button onClick={() => void win?.close()} aria-label="Close" title="Close" className={`${CTRL} hover:text-red-400`}>
                <svg width="14" height="14" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.3"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" /></svg>
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <GearsetView />
            </div>
          </div>
        </div>
      </ItemHoverProvider>
    </MotionConfig>
  );
}
