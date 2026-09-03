import { useState } from 'react';
import { Modal } from './overlay';
import { GilInput } from './ui';
import { IconInner } from './atlasIcon';
import { bzApply } from './bridge';
import { getCachedValue, useItemValues } from './priceStore';
import { itemStack } from './itemNames';
import { getMedianStack, toggleMedianStack, useMedianModeTick } from './medianMode';

export type BazaarItem = { id: number; n: string; c: number; s: number; bz?: number };

// Shared bazaar pricing modal, used from both Inventory and Library, for one item or many. When
// the items are already on the bazaar (bz set) it becomes "Modify In Bazaar": prices pre-filled
// with the current listing, plus a Take Off Bazaar action. Otherwise it's "Put On Bazaar" with
// prices pre-filled from each item's AH median. Lists / re-prices / unlists via bzApply.
export function BazaarPriceModal({ conn, items, server, iconSet, assets, onClose, onDone }: {
  conn: number; items: BazaarItem[]; server?: string; iconSet: Set<number>; assets?: string; onClose: () => void; onDone?: () => void;
}) {
  const modifying = items.length > 0 && items.every((it) => (it.bz ?? 0) > 0);
  const seed = (it: BazaarItem) => ((it.bz ?? 0) > 0 ? it.bz : (server ? getCachedValue(server, it.id)?.median : undefined));
  const [prices, setPrices] = useState<Record<number, string>>(() => {
    const m: Record<number, string> = {};
    for (const it of items) { const p = seed(it); if (p && p > 0) m[it.s] = String(p); }
    return m;
  });
  const [bulkPrice, setBulkPrice] = useState('');
  const single = items.length === 1;
  // Fetch the single-unit AH median for every item in the dialog so it can be shown next to the price
  // (the seed above only reads cache; this fills it in even for items never browsed). Bounded to the
  // handful of items in this modal, so no risk of bursting the AH like a whole-inventory scan would.
  const values = useItemValues(server, items.map((it) => it.id));
  const valuesStack = useItemValues(server, items.filter((it) => itemStack(it.id) > 1).map((it) => it.id), true);
  useMedianModeTick(); // re-render when a per-item stack/single toggle lands
  const medOf = (it: BazaarItem, stack: boolean) => (stack ? valuesStack : values).get(it.id)?.median ?? (server ? getCachedValue(server, it.id, stack)?.median : undefined);
  const stkOf = (it: BazaarItem) => itemStack(it.id) > 1 && getMedianStack(it.id);
  const medianOf = (it: BazaarItem) => medOf(it, stkOf(it)); // respects the per-item toggle (single by default)
  const priceOf = (it: BazaarItem) => prices[it.s] ?? '';
  const numOf = (v: string) => Math.max(0, Math.floor(Number(String(v).replace(/[^0-9]/g, '')) || 0));
  const setAll = (v: string) => setPrices(() => { const m: Record<number, string> = {}; for (const it of items) m[it.s] = v; return m; });
  const useMedians = () => setPrices(() => { const m: Record<number, string> = {}; for (const it of items) { const md = medianOf(it); if (md && md > 0) m[it.s] = String(md); } return m; });
  const priced = items.map((it) => ({ it, price: numOf(priceOf(it)) })).filter((x) => x.price > 0);

  const run = () => {
    if (conn == null || !priced.length) return;
    bzApply(conn, priced.map((x) => ({ index: x.it.s, price: x.price })));
    onDone?.();
    onClose();
  };
  const unlist = () => {
    if (conn == null) return;
    bzApply(conn, items.map((it) => ({ index: it.s, price: 0 }))); // price 0 removes it from the bazaar
    onDone?.();
    onClose();
  };

  const rowCls = 'flex items-center gap-2.5 rounded-md border border-line bg-field/40 px-2.5 py-1.5';
  const priceCls = 'shrink-0 w-24 text-right text-[12px] tabular-nums rounded-md border border-line bg-field px-2 py-1 text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50';

  return (
    <Modal onClose={onClose} backdropClose={false} panelClass="w-[min(94vw,420px)] p-4 gap-3">
      {(close) => (
        <>
          <div className="flex items-center gap-2">
            <div className="text-[14px] font-bold text-fg flex-1">{modifying ? 'Modify In Bazaar' : 'Put On Bazaar'}</div>
            <button onClick={close} aria-label="Close" className="le-tap shrink-0 grid place-items-center w-7 h-7 -mr-1 -mt-1 rounded-md text-fg-4 hover:text-fg hover:bg-field transition-colors">
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-fg-4 shrink-0">{single ? 'Price' : 'Set all'}</span>
            <GilInput
              value={single ? priceOf(items[0]) : bulkPrice}
              onChange={(d) => { if (single) setPrices((p) => ({ ...p, [items[0].s]: d })); else { setBulkPrice(d); setAll(d); } }}
              placeholder={single ? '0' : 'price each'}
              className="flex-1 min-w-0 bg-field border border-line rounded-md px-2.5 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50"
            />
            {server && (single
              ? (() => {
                  const it0 = items[0]; const stackable = itemStack(it0.id) > 1; const stk = stackable && getMedianStack(it0.id); const md = medOf(it0, stk); return (
                  <button
                    onClick={() => {
                      const next = stackable && !getMedianStack(it0.id);
                      if (stackable) toggleMedianStack(it0.id);
                      const val = medOf(it0, next) ?? md;
                      if (val) setPrices((p) => ({ ...p, [it0.s]: String(val) }));
                    }}
                    disabled={!md} title={stackable ? 'Toggle stack/single median and fill' : 'Use the AH median'} className="le-tap shrink-0 px-2.5 py-1.5 text-[11px] font-semibold rounded-md border border-line bg-field text-accent enabled:hover:text-accent-hover disabled:opacity-50 tabular-nums transition-colors">
                    {md ? `Median${stackable ? (stk ? ' · Stack' : ' · Each') : ''} · ${md.toLocaleString()}` : 'Median —'}
                  </button>
                ); })()
              : <button onClick={useMedians} className="le-tap shrink-0 px-2.5 py-1.5 text-[11px] font-semibold rounded-md border border-line bg-field text-accent hover:text-accent-hover transition-colors">AH median</button>
            )}
          </div>
          {single ? (
            <div className={rowCls}>
              <div className="shrink-0 w-7 h-7 rounded bg-field grid place-items-center overflow-hidden"><IconInner id={items[0].id} size={28} name={items[0].n} assets={assets} bmpHas={iconSet.has(items[0].id)} /></div>
              <span className="text-[12px] text-fg-2 truncate flex-1">{items[0].n}</span>
              {items[0].c > 1 && <span className="text-[11px] text-fg-4 tabular-nums shrink-0">×{items[0].c}</span>}
            </div>
          ) : (
            <div className="flex flex-col gap-1 max-h-[42vh] overflow-y-auto">
              {items.map((it) => (
                <div key={it.s} className={rowCls}>
                  <div className="shrink-0 w-7 h-7 rounded bg-field grid place-items-center overflow-hidden"><IconInner id={it.id} size={28} name={it.n} assets={assets} bmpHas={iconSet.has(it.id)} /></div>
                  <span className="text-[12px] text-fg-2 truncate flex-1">{it.n}</span>
                  {it.c > 1 && <span className="text-[11px] text-fg-4 tabular-nums shrink-0">×{it.c}</span>}
                  {(() => {
                    const stackable = itemStack(it.id) > 1; const stk = stackable && getMedianStack(it.id); const md = medOf(it, stk); return md ? (
                    <button
                      onClick={() => {
                        const next = stackable && !getMedianStack(it.id);
                        if (stackable) toggleMedianStack(it.id);
                        const val = medOf(it, next) ?? md;
                        setPrices((p) => ({ ...p, [it.s]: String(val) }));
                      }}
                      title={stackable ? 'Toggle stack/single median and fill' : 'Use the AH median'} className="le-tap shrink-0 text-[10px] tabular-nums text-fg-4 hover:text-accent transition-colors">{stackable ? (stk ? 'stk ' : 'ea ') : 'med '}{md.toLocaleString()}</button>
                  ) : null; })()}
                  <GilInput value={priceOf(it)} onChange={(d) => setPrices((p) => ({ ...p, [it.s]: d }))} placeholder="price" className={priceCls} />
                </div>
              ))}
            </div>
          )}
          {priced.length === 0 && <div className="text-[11px] text-amber-300">{modifying ? 'Set a price, or Take Off Bazaar to unlist.' : 'Set a price to list.'}</div>}
          <div className="flex items-center gap-2">
            <button onClick={close} className="flex-1 px-3 py-2 text-[12px] font-bold rounded-md bg-field border border-line text-fg-3 hover:text-fg-2 transition-colors">Cancel</button>
            {modifying && <button onClick={unlist} className="flex-1 px-3 py-2 text-[12px] font-bold rounded-md bg-red-500/15 text-red-300 border border-red-500/40 hover:bg-red-500/25 transition-colors">Take Off Bazaar</button>}
            <button onClick={run} disabled={priced.length === 0} className="flex-1 px-3 py-2 text-[12px] font-bold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors">
              {modifying ? (single ? 'Update Price' : `Update ${priced.length}`) : (single ? `List On Bazaar${priced.length ? ` · ${priced[0].price.toLocaleString()} gil` : ''}` : `Bazaar ${priced.length}`)}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
