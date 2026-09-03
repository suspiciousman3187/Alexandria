import { useState, useEffect, useLayoutEffect, useCallback, type ReactNode, type CSSProperties, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { logicalRect, logicalViewport, uiZoom } from './uiZoom';

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

export function Modal({
  onClose, children, panelClass = 'w-[min(94vw,460px)] max-h-[88vh]', backdropClose = true,
}: { onClose: () => void; children: ReactNode | ((close: () => void) => ReactNode); panelClass?: string; backdropClose?: boolean }) {
  const [open, setOpen] = useState(true);
  const close = useCallback(() => setOpen(false), []);
  // Under CSS `zoom` (uiScale > 1), a vh-sized panel (max-h-[88vh]/h-[82vh]) renders zoom-times too tall
  // and overflows the screen, so its bottom (scrollbar, footer) becomes unreachable. Cap the panel to the
  // real screen height by dividing the zoom back out. No-op at 100% so panelClass is untouched there.
  const z = uiZoom();
  const panelStyle = z > 1 ? ({ maxHeight: `calc(90vh / ${z})` } as CSSProperties) : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return createPortal(
    <AnimatePresence onExitComplete={onClose}>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          onClick={backdropClose ? close : undefined}
        >
          <motion.div
            className={`rounded-xl border border-line bg-surface-raised shadow-xl flex flex-col ${panelClass}`}
            style={panelStyle}
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
            onClick={(e) => e.stopPropagation()}
          >
            {typeof children === 'function' ? children(close) : children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function Crossfade({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={id}
        className={className}
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -5 }}
        transition={{ duration: 0.13, ease: EASE_OUT }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

// Animated height/opacity expand-collapse for disclosure rows. Replaces bare
// `{open && <div>}` so sections grow/shrink instead of snapping.
export function Collapse({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          className={className}
          style={{ overflow: 'hidden' }}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: EASE_OUT }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Popover({
  open, children, style, className = '', up = false, anchor,
}: { open: boolean; children: ReactNode; style?: CSSProperties; className?: string; up?: boolean; anchor?: RefObject<HTMLElement | null> }) {
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);
  useLayoutEffect(() => {
    if (!anchor || !open) return;
    const measure = () => {
      const el = anchor.current; if (!el) return;
      // Position in the popover's own (zoom-adjusted) coordinate space so a uiScale > 1 never throws the
      // dropdown off-screen; see uiZoom.ts. No-op at 100%.
      const r = logicalRect(el.getBoundingClientRect());
      const vh = logicalViewport().h;
      const below = vh - r.bottom;
      const flip = below < 248 && r.top > below; // no room under the input -> open upward
      setPos({ left: r.left, width: r.width, top: flip ? undefined : r.bottom + 4, bottom: flip ? vh - r.top + 4 : undefined });
    };
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => { window.removeEventListener('scroll', measure, true); window.removeEventListener('resize', measure); };
  }, [anchor, open]);

  // Anchored mode: render in a <body> portal fixed to the input, so no scroll
  // container or sibling panel can ever clip or cover the list on any window size.
  // This is the standard way to build a typeahead/dropdown here; pass `anchor`.
  if (anchor) {
    const flipUp = pos != null && pos.bottom != null;
    return createPortal(
      <AnimatePresence>
        {open && pos && (
          <motion.div
            className={className}
            style={{ position: 'fixed', left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, zIndex: 1000, ...style }}
            initial={{ opacity: 0, y: flipUp ? 4 : -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: flipUp ? 4 : -4, scale: 0.97 }}
            transition={{ duration: 0.14, ease: EASE_OUT }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>,
      document.body,
    );
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className={className}
          style={style}
          initial={{ opacity: 0, y: up ? 4 : -4, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: up ? 4 : -4, scale: 0.97 }}
          transition={{ duration: 0.14, ease: EASE_OUT }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
