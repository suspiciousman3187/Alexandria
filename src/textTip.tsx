import { useSyncExternalStore, type ReactNode, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';

// A small themed hover tooltip to replace native `title=` attributes. Store-driven (one bubble,
// no per-element portals), so spreading tipAttrs onto an element adds a styled tooltip without a
// wrapper or extra re-renders. Drop one <TextTipHost/> at the app root.
type Tip = { content: ReactNode; rect: DOMRect };
let cur: Tip | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const show = (content: ReactNode, el: HTMLElement) => { cur = { content, rect: el.getBoundingClientRect() }; emit(); };
const hide = () => { if (cur) { cur = null; emit(); } };

export function tipAttrs(content: ReactNode) {
  return {
    onMouseEnter: (e: MouseEvent<HTMLElement>) => show(content, e.currentTarget),
    onMouseLeave: hide,
    onPointerDown: hide,
  };
}

export function TextTipHost() {
  const st = useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => cur, () => cur);
  return createPortal(
    <AnimatePresence>{st && <TipBubble key="tt" tip={st} />}</AnimatePresence>,
    document.body,
  );
}

function TipBubble({ tip }: { tip: Tip }) {
  const { rect, content } = tip;
  const above = rect.top > 40;
  const cx = Math.min(Math.max(8, rect.left + rect.width / 2), window.innerWidth - 8);
  const top = above ? Math.max(6, rect.top - 6) : rect.bottom + 6;
  return (
    <motion.div
      className="fixed z-[9999] pointer-events-none max-w-[260px] rounded-md border border-line-2 bg-popover px-2 py-1 text-[11px] font-medium text-fg-2 shadow-xl"
      style={{ left: cx, top, transform: `translateX(-50%)${above ? ' translateY(-100%)' : ''}` }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.1 }}
    >
      {content}
    </motion.div>
  );
}
