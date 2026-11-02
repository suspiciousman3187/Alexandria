import { useEffect, useMemo, type PointerEvent as RPointerEvent } from 'react';
import { MotionConfig } from 'motion/react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ItemHoverProvider } from './ItemTooltip';
import { inTauri } from './bridge';
import { saveGearsetGeom } from './gearsetGeom';
import GearsetView from './GearsetView';
import { GearsetPlanWatcher } from './gearset/GearsetPlanWatcher';

type ResizeDir = 'NorthWest' | 'North' | 'NorthEast' | 'East' | 'SouthEast' | 'South' | 'SouthWest' | 'West';

export default function GearsetWindow() {
  const win = useMemo(() => (inTauri ? getCurrentWindow() : null), []);
  // Stamp the SDM theme on this webview's root so body-level portals (the item tooltip) inherit it too.
  useEffect(() => { document.documentElement.setAttribute('data-gearset', '1'); return () => document.documentElement.removeAttribute('data-gearset'); }, []);
  // Persist position + size (debounced) so the window reopens where the user left it, like the pool overlay.
  useEffect(() => {
    if (!win) return;
    let timer: number | undefined;
    const save = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        try {
          const sf = await win.scaleFactor();
          const sz = await win.innerSize();
          const pos = await win.outerPosition();
          const w = Math.round(sz.width / sf), h = Math.round(sz.height / sf);
          if (w > 0 && h > 0) void saveGearsetGeom({ x: Math.round(pos.x / sf), y: Math.round(pos.y / sf), w, h });
        } catch { /* ignore */ }
      }, 500);
    };
    let unMoved: (() => void) | undefined;
    let unResized: (() => void) | undefined;
    win.onMoved(save).then((u) => { unMoved = u; }).catch(() => {});
    win.onResized(save).then((u) => { unResized = u; }).catch(() => {});
    return () => { if (timer) window.clearTimeout(timer); unMoved?.(); unResized?.(); };
  }, [win]);
  const startResize = (dir: ResizeDir) => (e: RPointerEvent) => {
    if (!win) return;
    e.preventDefault();
    e.stopPropagation();
    win.startResizeDragging(dir).catch(() => {});
  };
  return (
    <MotionConfig reducedMotion="user">
      <ItemHoverProvider>
        <div className="gearset-scope relative w-screen h-screen overflow-hidden bg-[var(--color-bg)] text-fg-2">
          <div className="gearset-bg" />
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
          <div className="relative z-10 h-full flex flex-col">
            <div className="flex-1 min-h-0">
              <GearsetView win={win} />
            </div>
            <GearsetPlanWatcher />
          </div>
        </div>
      </ItemHoverProvider>
    </MotionConfig>
  );
}
