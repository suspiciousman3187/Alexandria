import { MotionConfig, motion } from 'motion/react';
import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ItemHoverProvider } from './ItemTooltip';
import { inTauri, broadcastSync, useBoxes } from './bridge';
import { useStickyPersisted } from './sticky';
import { ErrorBoundary } from './ErrorBoundary';
import { savePoolGeom } from './poolGeom';
import PoolView from './PoolView';

type ResizeDir = 'NorthWest' | 'North' | 'NorthEast' | 'East' | 'SouthEast' | 'South' | 'SouthWest' | 'West';
const CTRL = 'w-5 h-5 flex items-center justify-center rounded hover:bg-line transition-colors';

export default function PoolOverlay() {
  const win = useMemo(() => (inTauri ? getCurrentWindow() : null), []);
  const [ontop, setOntop] = useStickyPersisted('pool.overlay.ontop', true);
  // Disk-backed so opacity + compact-rows survive closing/reopening the pop-out and app restarts;
  // a separate window's in-memory store starts empty every time, which reset these each reopen.
  const [dense, setDense] = useStickyPersisted('pool.overlay.dense', false);
  const [opacity, setOpacity] = useStickyPersisted('pool.overlay.opacity', 1);
  const [hovered, setHovered] = useState(false);
  const [opRect, setOpRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    win?.setAlwaysOnTop(ontop).catch(() => {});
    // Un-pinned, the overlay is no longer topmost and drops behind the game. With skipTaskbar it
    // then has no taskbar button either, so it becomes unreachable and reads as "disappeared".
    // Surface it in the taskbar whenever it is un-pinned so it can always be raised again.
    win?.setSkipTaskbar(ontop).catch(() => {});
  }, [ontop, win]);
  const boxes = useBoxes();
  const connKey = boxes.map((b) => b.conn).sort((a, b) => a - b).join(',');
  useEffect(() => {
    if (!connKey) return;
    void broadcastSync();
    const t = window.setTimeout(() => void broadcastSync(), 1200);
    return () => window.clearTimeout(t);
  }, [connKey]);
  // Remember the pop-out's position + size (logical px) across closes and restarts.
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
          if (w > 0 && h > 0) void savePoolGeom({ x: Math.round(pos.x / sf), y: Math.round(pos.y / sf), w, h });
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
  const minimize = async () => {
    if (!win) return;
    try { await win.setSkipTaskbar(false); } catch { /* ignore */ }
    try { await win.minimize(); } catch { /* ignore */ }
  };
  return (
    <MotionConfig reducedMotion="user">
      <ItemHoverProvider>
        <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} className="relative w-screen h-screen p-1.5 text-fg-2">
          {inTauri && <>
            <div onPointerDown={startResize('North')} className="absolute top-0 left-3 right-3 h-1.5 cursor-n-resize z-30" />
            <div onPointerDown={startResize('South')} className="absolute bottom-0 left-3 right-3 h-1.5 cursor-s-resize z-30" />
            <div onPointerDown={startResize('West')} className="absolute top-3 bottom-3 left-0 w-1.5 cursor-w-resize z-30" />
            <div onPointerDown={startResize('East')} className="absolute top-3 bottom-3 right-0 w-1.5 cursor-e-resize z-30" />
            <div onPointerDown={startResize('NorthWest')} className="absolute top-0 left-0 w-3 h-3 cursor-nw-resize z-30" />
            <div onPointerDown={startResize('NorthEast')} className="absolute top-0 right-0 w-3 h-3 cursor-ne-resize z-30" />
            <div onPointerDown={startResize('SouthWest')} className="absolute bottom-0 left-0 w-3 h-3 cursor-sw-resize z-30" />
            <div onPointerDown={startResize('SouthEast')} className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize z-30" />
          </>}
          <div style={{ opacity: hovered && !opRect ? 1 : opacity, transition: 'opacity 0.12s ease', '--panel-opacity': 1.2 } as CSSProperties} className="h-full flex flex-col border border-line rounded-xl overflow-hidden bg-surface-raised shadow-lg shadow-black/40">
            <div data-tauri-drag-region className="shrink-0 flex items-center gap-2 pl-2.5 pr-1 py-1 border-b border-line select-none">
              <span data-tauri-drag-region className="w-[3px] h-3 rounded bg-accent shrink-0" />
              <span data-tauri-drag-region className="flex-1 h-full flex items-center text-[10px] font-extrabold tracking-[0.16em] text-accent cursor-move">TREASURE POOL</span>
              <button onClick={(e) => setOpRect(opRect ? null : (e.currentTarget as HTMLElement).getBoundingClientRect())} aria-label="Overlay opacity" title="Overlay opacity" className={`${CTRL} ${opacity < 1 ? 'text-accent' : 'text-fg-4'}`}>
                <svg viewBox="0 0 24 24" width="13" height="13"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" /></svg>
              </button>
              <button onClick={() => setDense((v) => !v)} aria-label="Compact rows" title={dense ? 'Compact rows: on' : 'Compact rows: off'} className={`${CTRL} ${dense ? 'text-accent' : 'text-fg-4'}`}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
              </button>
              <button onClick={() => setOntop((v) => !v)} aria-label="Always on top" title={ontop ? 'Always on top: on' : 'Always on top: off'} className={`${CTRL} ${ontop ? 'text-accent' : 'text-fg-4'}`}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill={ontop ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 17v5" /><path d="M9 10.76V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v6.76a2 2 0 0 0 .59 1.41l1.7 1.7A1 1 0 0 1 17.59 16H6.41a1 1 0 0 1-.7-1.71l1.7-1.7A2 2 0 0 0 8 11.16" /></svg>
              </button>
              <button onClick={() => void minimize()} aria-label="Minimize" title="Minimize" className={`${CTRL} text-fg-4 hover:text-fg-2`}>
                <svg width="13" height="13" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2.5 9.5h7" /></svg>
              </button>
              <button onClick={() => void win?.close()} aria-label="Close" title="Close" className={`${CTRL} text-fg-4 hover:text-red-400`}>
                <svg width="13" height="13" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.3"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" /></svg>
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <ErrorBoundary label="Treasure pool error">
                <PoolView view="pool" compact dense={dense} />
              </ErrorBoundary>
            </div>
          </div>
          {opRect && createPortal(
            <>
              <div className="fixed inset-0 z-[80]" onMouseDown={() => setOpRect(null)} />
              <motion.div className="fixed z-[81] rounded-lg border border-line bg-popover shadow-2xl px-2.5 py-2 flex items-center gap-2" style={{ top: opRect.bottom + 4, right: Math.max(4, Math.round(window.innerWidth - opRect.right)), transformOrigin: 'top right' }} initial={{ opacity: 0, scale: 0.97, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}>
                <input type="range" min={20} max={100} value={Math.round(opacity * 100)} onChange={(e) => setOpacity(Number(e.target.value) / 100)} className="w-28 accent-[var(--color-accent)] cursor-pointer" />
                <span className="text-[10px] tabular-nums text-fg-4 w-8 text-right">{Math.round(opacity * 100)}%</span>
              </motion.div>
            </>,
            document.body,
          )}
        </div>
      </ItemHoverProvider>
    </MotionConfig>
  );
}
