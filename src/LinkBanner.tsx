import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useIpcBound, inTauri } from './bridge';

// Warns when the app is running but its in-game link port (127.0.0.1:24233) is NOT bound -- almost always
// because another Alexandria is still running (often minimized to the system tray) and already holds the
// port. In that state the addon shows "app not running; cannot run commands" even though this window is up,
// which is exactly the confusing symptom users report. We only show it after the link stays down a few
// seconds so a normal startup/update relaunch (where the port is briefly free) never flashes the banner.
const GRACE_MS = 6000;

export default function LinkBanner() {
  const bound = useIpcBound();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!inTauri) return;
    if (bound) { setShow(false); return; }
    const t = setTimeout(() => setShow(true), GRACE_MS);
    return () => clearTimeout(t);
  }, [bound]);

  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="shrink-0 border-b border-red-500/40 bg-red-500/10 overflow-hidden"
        >
          <div className="flex items-start gap-3 px-4 py-2 text-[12px]">
            <svg viewBox="0 0 24 24" className="w-4 h-4 text-red-300 shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
            <div className="text-fg-2 leading-relaxed">
              <span className="font-semibold text-red-200">In-game link unavailable.</span>{' '}
              Alexandria can't open its game port (127.0.0.1:24233), so the addon shows
              <span className="text-fg-3"> "app not running"</span> even though this window is open. Another copy is
              most likely still running, often in the system tray. Quit every Alexandria (check the tray icon), then
              reopen this one. The addon reconnects on its own within a few seconds once the port is free.
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
