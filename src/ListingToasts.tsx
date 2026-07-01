import { AnimatePresence, motion } from 'motion/react';
import { useAhListings, dismissListing } from './bridge';
import { OpCard, type OpState } from './OpCard';

const toState = (s: 'pending' | 'ok' | 'fail'): OpState => (s === 'pending' ? 'active' : s);

export default function ListingToasts() {
  const all = useAhListings();
  const listings = all.filter((l) => l.batchId == null);
  return (
    <div className="fixed bottom-3 right-3 z-[60] flex flex-col gap-2 w-[260px] pointer-events-none">
      <AnimatePresence initial={false}>
        {listings.map((l) => (
          <motion.div
            key={l.key}
            layout
            initial={{ opacity: 0, x: 24, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-auto"
          >
            <OpCard
              state={toState(l.status)}
              title={l.name || 'Item'}
              sublabel={l.status === 'pending' ? 'Listing on the auction house…' : l.status === 'ok' ? 'Listed for sale' : (l.reason || 'Listing failed')}
              className="shadow-lg"
              trailing={l.status === 'fail' ? (
                <button onClick={() => dismissListing(l.key)} aria-label="Dismiss" className="le-tap shrink-0 text-fg-4 hover:text-fg transition-colors">
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
                </button>
              ) : undefined}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
