import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ahSell, addPendingListing, newBatchId, dismissBatch, useAhListings, type InvItem, type SelItem, type KnownChar } from './bridge';
import { IconInner } from './atlasIcon';
import { Segmented, GilInput, Stepper } from './ui';
import { Modal, Crossfade, Collapse } from './overlay';
import { useItemHover } from './ItemTooltip';
import { MarketLookup } from './MarketBlock';
import { useAnon } from './anonymize';
import { OpCard, OpGlyph, type OpState } from './OpCard';

const toOp = (s: 'pending' | 'ok' | 'fail'): OpState => (s === 'pending' ? 'active' : s);

type StageItem = { item: SelItem; single: number; price: string; qty: number };
const priceOf = (s: string) => Number(s.replace(/[,\s]/g, '')) || 0;

function Icon({ id, n, c, assets, iconSet }: { id: number; n: string; c?: number; assets?: string; iconSet: Set<number> }) {
  const hover = useItemHover({ id, n, c });
  return (
    <div {...hover} className="relative shrink-0 w-6 h-6 rounded bg-field grid place-items-center overflow-hidden">
      <IconInner id={id} size={24} name={n} assets={assets} bmpHas={id > 0 && iconSet.has(id)} />
    </div>
  );
}

function StageRow({ row, assets, iconSet, server, onChange, onRemove }: { row: StageItem; assets?: string; iconSet: Set<number>; server?: string; onChange: (p: Partial<StageItem>) => void; onRemove: () => void }) {
  const [showMkt, setShowMkt] = useState(false);
  const { item, single, price, qty } = row;
  return (
    <div className="rounded-lg border border-line bg-surface p-2.5 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Icon id={item.id} n={item.n} assets={assets} iconSet={iconSet} />
        <span className="min-w-0 flex-1 truncate text-[12px] text-fg-2">{item.n}</span>
        <span className="shrink-0 text-[10px] text-fg-4 tabular-nums">×{item.c}</span>
        <button onClick={onRemove} aria-label="Remove" className="shrink-0 grid place-items-center w-6 h-6 rounded-md text-fg-4 hover:text-fg hover:bg-line transition-colors">
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
      <div className="flex items-center gap-2">
        <Segmented value={String(single)} onChange={(v) => onChange({ single: Number(v) })} options={[{ v: '1', label: 'Single' }, ...(item.c > 1 ? [{ v: '0', label: 'Stack' }] : [])]} />
        <GilInput
          value={price}
          onChange={(d) => onChange({ price: d })}
          placeholder="Price (gil)"
          className="flex-1 min-w-0 bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 tabular-nums"
        />
        <Stepper value={qty} min={1} max={7} onChange={(v) => onChange({ qty: v })} title="Quantity" className="shrink-0" />
      </div>
      <button onClick={() => setShowMkt((s) => !s)} className="le-tap self-start inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-line bg-field text-[11px] font-semibold text-fg-3 hover:text-fg hover:border-line-2 transition-colors">
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="m2 7 4.4-4.4a2 2 0 0 1 1.4-.6h8.4a2 2 0 0 1 1.4.6L22 7" /><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><path d="M2 7h20" /></svg>
        {showMkt ? 'Hide FFXIAH Prices' : 'Show FFXIAH Prices'}
      </button>
      <Collapse open={showMkt}><MarketLookup id={item.id} stack={single === 0} server={server} /></Collapse>
    </div>
  );
}

function BatchProgress({ batchId, onClear }: { batchId: number; onClear: () => void }) {
  const listings = useAhListings().filter((l) => l.batchId === batchId);
  const total = listings.length;
  const done = listings.filter((l) => l.status !== 'pending').length;
  const ok = listings.filter((l) => l.status === 'ok').length;
  const failed = listings.filter((l) => l.status === 'fail').length;
  const allDone = total > 0 && done === total;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-3">
      <OpCard
        state={allDone ? (ok > 0 ? 'ok' : 'fail') : 'active'}
        title={allDone ? 'Listing Complete' : 'Listing Items…'}
        count={`${done} / ${total}`}
        pct={pct}
        sublabel={`${ok} listed${failed ? `, ${failed} failed` : ''}${!allDone ? ` · about ${(total - done) * 5}s left` : ''}`}
      />
      <div className="rounded-lg border border-line bg-surface overflow-hidden divide-y divide-line max-h-[40vh] overflow-y-auto">
        {listings.map((l) => (
          <div key={l.key} className="flex items-center gap-2.5 px-3 py-1.5 text-[12px]">
            <span className="shrink-0 w-4 h-4 grid place-items-center"><OpGlyph state={toOp(l.status)} className="w-3.5 h-3.5" /></span>
            <span className="min-w-0 flex-1 truncate text-fg-2">{l.name}</span>
            <span className="shrink-0 text-[10px] text-fg-4 truncate max-w-[140px]">{l.status === 'pending' ? 'listing…' : l.status === 'ok' ? 'listed' : (l.reason || 'failed')}</span>
          </div>
        ))}
      </div>
      <button onClick={onClear} className={`px-4 py-2 text-[12px] font-semibold rounded-md transition-colors ${allDone ? 'bg-accent text-on-accent hover:bg-accent-hover' : 'border border-line text-fg-3 hover:text-fg-2'}`}>
        {allDone ? 'Done' : 'Hide (listings keep processing)'}
      </button>
    </div>
  );
}

export function SellDrawer({ char, items, iconSet, onClose, onListed }: { char: KnownChar; items: SelItem[]; iconSet: Set<number>; onClose: () => void; onListed?: () => void }) {
  const anon = useAnon();
  const atah = !!(char.atah ?? char.ah?.atah);
  const conn = char.conn ?? undefined;
  const anyFromBag = items.some((it) => it.bag !== 0);
  // Defensive: only auction-eligible items can be listed (not Ex/No-Trade or No-AH = 0x0A, and not augmented).
  const [stage, setStage] = useState<StageItem[]>(() => items.filter((it) => !((it.f ?? 0) & 0x0A) && !(it.aug && it.aug.length)).map((it) => ({ item: it, single: 1, price: '', qty: 1 })));
  const [batchId, setBatchId] = useState<number | null>(null);

  const patchRow = (id: number, patch: Partial<StageItem>) => setStage((s) => s.map((x) => (x.item.id === id ? { ...x, ...patch } : x)));
  const removeRow = (id: number) => setStage((s) => s.filter((x) => x.item.id !== id));

  const ready = stage.filter((r) => priceOf(r.price) > 0);
  const canList = atah && conn != null && ready.length > 0;

  const listAll = () => {
    if (!canList || conn == null) return;
    const id = newBatchId();
    for (const r of ready) {
      const price = priceOf(r.price);
      const fb = r.item.bag !== 0;
      ahSell(conn, r.item.id, r.single, price, r.qty, fb ? r.item.bag : undefined, fb ? r.item.s : undefined);
      for (let i = 0; i < r.qty; i++) addPendingListing(conn, r.item.n, id);
    }
    setBatchId(id);
  };

  const finalize = () => {
    if (batchId != null) { dismissBatch(batchId); onListed?.(); }
    onClose();
  };

  return (
    <Modal onClose={finalize} panelClass="w-[min(94vw,460px)] max-h-[88vh]">
      {(close) => (
        <>
          <div className="shrink-0 flex items-center gap-2 px-4 pt-3.5 pb-2.5 border-b border-line">
            <div className="text-[14px] font-bold text-fg">{batchId != null ? 'Listing Items' : `List ${stage.length} Item${stage.length === 1 ? '' : 's'} on AH`}</div>
            <button onClick={close} aria-label="Close" className="le-tap ml-auto grid place-items-center w-7 h-7 rounded-md text-fg-4 hover:text-fg hover:bg-line transition-colors">
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-2">
            <Crossfade id={batchId != null ? 'progress' : 'stage'} className="flex flex-col gap-2">
              {batchId != null ? (
                <BatchProgress batchId={batchId} onClear={close} />
              ) : (
                <>
                  {!atah && <div className="text-[11px] text-amber-300 border border-amber-500/30 bg-amber-500/10 rounded-md px-2.5 py-1.5">{anon(char.name)} must be in a zone with an auction house to list items for sale.</div>}
                  {anyFromBag && <div className="text-[11px] text-fg-4 leading-snug">Some of these aren't in your main Inventory. Alexandria moves each to Inventory first, then lists it. The bag must be accessible from where you're standing.</div>}
                  {stage.length === 0 ? (
                    <div className="text-center text-[12px] text-fg-4 py-8">No auctionable items selected.</div>
                  ) : (
                    <AnimatePresence mode="popLayout" initial={false}>
                      {stage.map((r) => (
                        <motion.div key={r.item.id} layout initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}>
                          <StageRow row={r} assets={char.assets} iconSet={iconSet} server={char.server} onChange={(p) => patchRow(r.item.id, p)} onRemove={() => removeRow(r.item.id)} />
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  )}
                </>
              )}
            </Crossfade>
          </div>
          {batchId == null && (
            <div className="shrink-0 flex items-center gap-2 px-3 py-2.5 border-t border-line">
              <button onClick={close} className="le-tap px-3 py-1.5 text-[12px] rounded-md border border-line text-fg-3 hover:text-fg-2 transition-colors">Cancel</button>
              <button onClick={listAll} disabled={!canList} className="le-tap ml-auto inline-flex items-center gap-1.5 px-4 py-1.5 text-[12px] font-semibold rounded-md bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-40 transition-colors">
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><circle cx="7" cy="7" r="1.2" /></svg>
                {ready.length === stage.length
                  ? `List ${ready.length} Item${ready.length === 1 ? '' : 's'}`
                  : `List ${ready.length} of ${stage.length} (${stage.length - ready.length} need a price)`}
              </button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
