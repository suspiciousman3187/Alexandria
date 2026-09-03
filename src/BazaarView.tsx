import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useKnownCharacters, useAvailableIcons, useBzBuy, bzOpen, bzApply, bzClose, bzMySync, bzScan, bzDeepScan, bzScanStop, bzBuy, nextBzBuy, bzRange, bzWatch, type MyBazaarItem, type BazaarSeller, type BazaarListing, type BazaarScan } from './bridge';
import { IconInner } from './atlasIcon';
import { Group, Segmented, SectionTabs, CharacterSelect, GilInput, Stepper, SearchInput, Button } from './ui';
import { Crossfade, Modal, Collapse } from './overlay';
import { useItemHover } from './ItemTooltip';
import { useCart, addToCart, setCartQty, removeFromCart, clearCart, getCart, cartKey, type CartEntry } from './bzCart';
import { useSticky, useStickyChar } from './sticky';
import { useSettings } from './settings';
import { OpCard } from './OpCard';
import { useBzBlacklist, addBzBlacklist, removeBzBlacklist } from './bzBlacklist';
import { itemNameMatches, itemStack } from './itemNames';
import { useItemValues, getCachedValue } from './priceStore';
import { getMedianStack, toggleMedianStack, useMedianModeTick } from './medianMode';

const SCAN_RANGE = 50;

const fmtGil = (v: number) => v.toLocaleString();

function agoLabel(ts: number, now: number) {
  if (!ts) return '';
  const m = Math.floor((now - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function Icon({ id, n, c, assets, iconSet }: { id: number; n: string; c?: number; assets?: string; iconSet: Set<number> }) {
  const hover = useItemHover({ id, n, c });
  return (
    <div {...hover} className="relative shrink-0 w-8 h-8 rounded bg-field grid place-items-center overflow-hidden">
      <IconInner id={id} size={32} name={n} assets={assets} bmpHas={id > 0 && iconSet.has(id)} />
    </div>
  );
}

function Check({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`shrink-0 grid place-items-center w-4 h-4 rounded border transition-colors ${on ? 'bg-accent border-accent text-on-accent' : 'border-line bg-field hover:border-accent/60'}`}>
      {on && <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>}
    </button>
  );
}

function MyBazaarPanel({ conn, items, server, assets, iconSet }: { conn: number; items: MyBazaarItem[]; server?: string; assets?: string; iconSet: Set<number> }) {
  const [prices, setPrices] = useState<Record<number, string>>({});
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [bulkPrice, setBulkPrice] = useState('');
  const [search, setSearch] = useSticky('bz.my.search', '');
  useEffect(() => { bzMySync(conn); }, [conn]);

  // AH median per item, shown beside each price field so you can price competitively without leaving the
  // tab. Bounded to your sellable stock (one bazaar's worth), so fetching them all is fine.
  const values = useItemValues(server, items.map((it) => it.id));
  const valuesStack = useItemValues(server, items.filter((it) => itemStack(it.id) > 1).map((it) => it.id), true);
  useMedianModeTick(); // re-render this list when any per-item stack/single toggle lands
  // Median for an item at the given stack mode (stack median is a real stacked-listing price, not single x N).
  const medOf = (it: MyBazaarItem, stack: boolean) => (stack ? valuesStack : values).get(it.id)?.median ?? (server ? getCachedValue(server, it.id, stack)?.median : undefined);

  // Filter the sellable inventory by item name (same fuzzy match the Browse tab uses). Selection and edited
  // prices persist across filter changes; bulk Select acts on what's currently visible.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? items.filter((it) => itemNameMatches(it.id, it.n, q)) : items;
  }, [items, search]);

  const setPrice = (slot: number, v: string) => setPrices((p) => ({ ...p, [slot]: v.replace(/[^0-9]/g, '') }));
  const priceOf = (it: MyBazaarItem) => (prices[it.slot] !== undefined ? prices[it.slot] : (it.listed ? String(it.price) : ''));

  const apply = () => {
    const changed: { index: number; price: number }[] = [];
    for (const it of items) {
      const raw = prices[it.slot];
      if (raw === undefined || raw === '') continue;
      const price = Number(raw);
      if (it.listed && price === it.price) continue;
      changed.push({ index: it.slot, price });
    }
    if (changed.length) bzApply(conn, changed);
  };

  const toggle = (slot: number) => setSel((s) => { const n = new Set(s); if (n.has(slot)) n.delete(slot); else n.add(slot); return n; });
  const allOn = filtered.length > 0 && filtered.every((i) => sel.has(i.slot));
  const toggleAll = () => setSel((s) => { const n = new Set(s); if (allOn) filtered.forEach((i) => n.delete(i.slot)); else filtered.forEach((i) => n.add(i.slot)); return n; });
  const selSlots = items.filter((i) => sel.has(i.slot)).map((i) => i.slot);

  // Click+drag to paint a selection across rows (like the inventory grid). The first row sets the
  // mode (add if it wasn't selected, remove if it was); dragging over rows applies that mode.
  const dragMode = useRef<boolean | null>(null);
  const startDrag = (slot: number) => {
    const adding = !sel.has(slot);
    dragMode.current = adding;
    setSel((s) => { const n = new Set(s); if (adding) n.add(slot); else n.delete(slot); return n; });
  };
  const dragOver = (slot: number) => {
    if (dragMode.current === null) return;
    setSel((s) => { const n = new Set(s); if (dragMode.current) n.add(slot); else n.delete(slot); return n; });
  };
  useEffect(() => {
    const up = () => { dragMode.current = null; };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

  const listSelected = () => {
    const price = Number(bulkPrice);
    if (!price || price <= 0 || selSlots.length === 0) return;
    bzApply(conn, selSlots.map((index) => ({ index, price })));
    setSel(new Set());
  };
  const unlist = (slots: number[]) => { if (slots.length) bzApply(conn, slots.map((index) => ({ index, price: 0 }))); };
  const listed = items.filter((i) => i.listed);

  return (
    <>
      <div className="flex items-center justify-between px-1 mb-2">
        <span className="text-[11px] font-bold tracking-[0.12em] text-fg">ITEMS{listed.length > 0 ? ` · ${listed.length} listed` : ''}</span>
        <div className="flex items-center gap-1.5">
          {listed.length > 0 && <button onClick={() => unlist(listed.map((i) => i.slot))} className="px-2.5 py-1 text-[11px] font-semibold rounded-md border border-line bg-field text-fg-3 hover:text-fg transition-colors">Unlist All</button>}
          <button onClick={() => bzClose(conn)} className="px-2.5 py-1 text-[11px] font-semibold rounded-md border border-line bg-field text-fg-3 hover:text-fg transition-colors">Close Bazaar</button>
          <button onClick={apply} className="px-3 py-1 text-[11px] font-bold rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors">Apply Prices</button>
        </div>
      </div>
      {items.length > 0 && (
        <SearchInput
          value={search}
          onChange={setSearch}
          wrap="mb-2"
          placeholder="Filter your items"
          className="w-full bg-field border border-line rounded-md px-2.5 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50"
        />
      )}
      {items.length > 0 && (
        <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-lg bg-field border border-line">
          <Check on={allOn} onClick={toggleAll} />
          <span className="text-[11px] text-fg-3 w-16">{sel.size > 0 ? `${sel.size} picked` : 'Select'}</span>
          <GilInput
            value={bulkPrice}
            onChange={setBulkPrice}
            placeholder="price each"
            className="flex-1 min-w-0 text-right text-[12px] tabular-nums rounded-md border border-line bg-surface px-2 py-1.5 text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50"
          />
          <button onClick={listSelected} disabled={sel.size === 0 || !bulkPrice} className="px-2.5 py-1.5 text-[11px] font-bold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors">List Selected</button>
          <button onClick={() => { unlist(selSlots); setSel(new Set()); }} disabled={sel.size === 0} className="px-2.5 py-1.5 text-[11px] font-semibold rounded-md border border-line bg-surface text-fg-3 enabled:hover:text-fg disabled:opacity-40 transition-colors">Unlist</button>
        </div>
      )}
      <div className="rounded-xl bg-surface border border-line divide-y divide-line">
        {items.length === 0 ? (
          <div className="text-[12px] text-fg-4 text-center py-8">No sellable items in your inventory.</div>
        ) : filtered.length === 0 ? (
          <div className="text-[12px] text-fg-4 text-center py-8">No items match your filter.</div>
        ) : (
          <AnimatePresence mode="popLayout" initial={false}>
          {filtered.map((it) => (
            <motion.div
              key={it.slot}
              layout
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              onPointerEnter={() => dragOver(it.slot)}
              className="flex items-center gap-3 px-3 py-2"
            >
            <Check on={sel.has(it.slot)} onClick={() => toggle(it.slot)} />
            <div className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer select-none" onPointerDown={(e) => { e.preventDefault(); startDrag(it.slot); }}>
              <Icon id={it.id} n={it.n} assets={assets} iconSet={iconSet} />
              <div className="min-w-0 flex-1">
                {it.listed && <span className="block text-[9px] font-bold uppercase tracking-wide text-amber-300 leading-none mb-0.5">Listed</span>}
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-fg truncate">{it.n}</span>
                  {it.count > 1 && <span className="shrink-0 text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded bg-field text-fg-3">×{it.count}</span>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {(() => {
                const stackable = itemStack(it.id) > 1;
                const stk = stackable && getMedianStack(it.id);
                const md = medOf(it, stk);
                if (md == null) return null;
                return (
                  <button
                    onClick={() => {
                      const next = stackable && !getMedianStack(it.id);
                      if (stackable) toggleMedianStack(it.id);
                      const val = medOf(it, next) ?? md;
                      setPrice(it.slot, String(val));
                    }}
                    title={stackable ? 'Toggle stack/single median and fill the price' : 'Use the AH median'}
                    className="le-tap shrink-0 flex flex-col items-end leading-tight hover:opacity-80 transition-opacity"
                  >
                    <span className="text-[9px] font-bold uppercase tracking-wide text-fg-4">Median{stackable ? (stk ? ' · Stack' : ' · Each') : ''}</span>
                    <span className="text-[12.5px] font-semibold tabular-nums text-yellow-300">{md.toLocaleString()}</span>
                  </button>
                );
              })()}
              <GilInput
                value={priceOf(it)}
                onChange={(d) => setPrice(it.slot, d)}
                placeholder="price"
                className="w-24 text-right text-[12px] tabular-nums rounded-md border border-line bg-field px-2 py-1.5 text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50"
              />
              <span className="text-[10px] text-fg-4 w-5">gil</span>
              {it.listed ? (
                <button onClick={() => unlist([it.slot])} title="Unlist" className="grid place-items-center w-7 h-7 rounded-md border border-line bg-field text-fg-4 hover:text-red-300 hover:border-red-500/40 transition-colors">
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              ) : <span className="w-7" />}
            </div>
          </motion.div>
          ))}
          </AnimatePresence>
        )}
      </div>
    </>
  );
}

function ScanBar({ scan, onStop }: { scan: BazaarScan; onStop: () => void }) {
  const pct = scan.total > 0 ? Math.min(100, Math.round((scan.done / scan.total) * 100)) : 0;
  return (
    <OpCard
      className="mb-3"
      state="active"
      title="Scanning bazaars…"
      sublabel={scan.current || undefined}
      count={`${scan.done} / ${scan.total}`}
      pct={pct}
      trailing={<button onClick={onStop} className="shrink-0 px-2.5 py-1 text-[11px] font-semibold rounded-md border border-line bg-field text-fg-3 hover:text-fg transition-colors">Stop</button>}
    />
  );
}

type Row = { sellerId: number; seller: string; sellerIndex: number; bidx: number; id: number; n: string; price: number; qty: number; dist: number; inrange: boolean; cheapest: boolean; at: number };

const entryFromRow = (r: Row, qty: number): CartEntry => ({
  key: cartKey(r.sellerId, r.bidx), sellerId: r.sellerId, sellerIndex: r.sellerIndex, bidx: r.bidx,
  id: r.id, n: r.n, seller: r.seller, price: r.price, qty, maxQty: r.qty,
});

function ItemRow({ row, assets, iconSet, inCart, onBuy, onAddList }: { row: Row; assets?: string; iconSet: Set<number>; inCart: boolean; onBuy: () => void; onAddList: () => void }) {
  return (
    <div className="px-3 py-2 flex items-center gap-3">
      <Icon id={row.id} n={row.n} assets={assets} iconSet={iconSet} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-fg truncate">{row.n}</span>
          {row.cheapest && <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">cheapest</span>}
        </div>
        <div className="flex items-baseline gap-2 mt-0.5 min-w-0">
          <span className="shrink-0 text-[14px] font-bold tabular-nums text-amber-300">{fmtGil(row.price)}<span className="text-[11px] font-medium text-fg-4"> gil{row.qty > 1 ? ' ea' : ''}</span></span>
          {row.qty > 1 && <span className="shrink-0 text-[13px] font-bold tabular-nums text-fg-2">{row.qty}<span className="text-[11px] font-medium text-fg-4"> avail</span></span>}
          <span className="text-[11px] text-fg-4 tabular-nums truncate">· {row.seller} · {row.dist.toFixed(0)}y{!row.inrange ? ' (out of range)' : ''}</span>
        </div>
      </div>
      <button
        onClick={onAddList}
        disabled={!row.inrange}
        title={inCart ? 'In buy list' : 'Add to buy list'}
        className={`shrink-0 grid place-items-center w-8 h-8 rounded-md border transition-colors disabled:opacity-40 ${inCart ? 'border-accent bg-accent/15 text-accent' : 'border-line bg-field text-fg-3 enabled:hover:text-fg enabled:hover:border-line-2'}`}
      >
        {inCart
          ? <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
          : <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>}
      </button>
      <button
        onClick={onBuy}
        disabled={!row.inrange}
        title={!row.inrange ? 'Walk closer to buy' : undefined}
        className="shrink-0 px-3 py-1.5 text-[12px] font-bold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors"
      >
        Buy
      </button>
    </div>
  );
}

function BuyModal({ conn, row, gil, assets, iconSet, onClose }: { conn: number; row: Row; gil: number; assets?: string; iconSet: Set<number>; onClose: () => void }) {
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState<string | null>(null);
  const total = row.price * qty;
  const afford = gil >= total;
  const inCart = getCart().some((c) => c.key === cartKey(row.sellerId, row.bidx));

  return (
    <Modal onClose={onClose} panelClass="w-[min(94vw,400px)]">
      {(close) => (
        <div className="p-4 flex flex-col gap-3.5">
          <div className="flex items-center gap-3">
            <Icon id={row.id} n={row.n} assets={assets} iconSet={iconSet} />
            <div className="min-w-0">
              <div className="text-[14px] font-bold text-fg truncate">{row.n}</div>
              <div className="text-[11px] text-fg-4 tabular-nums truncate">{fmtGil(row.price)} gil ea · {row.seller} · {row.dist.toFixed(0)}y</div>
            </div>
          </div>

          {row.qty > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-fg-4 w-14 shrink-0">Quantity</span>
              <Stepper value={qty} min={1} max={row.qty} onChange={setQty} />
              <button onClick={() => setQty(row.qty)} disabled={qty >= row.qty} className="le-tap px-2.5 py-1.5 text-[11px] font-semibold rounded-md border border-line bg-field text-fg-3 enabled:hover:text-fg disabled:opacity-40 transition-colors">Buy All ({row.qty})</button>
            </div>
          )}

          <div className="text-[13px] text-fg-2">
            Buy <span className="font-extrabold text-accent">{qty}{row.qty > 1 ? ` of ${row.qty}` : ''}</span> for <span className={`font-extrabold tabular-nums ${afford ? 'text-amber-300' : 'text-red-300'}`}>{fmtGil(total)} gil</span>?
          </div>
          {!afford && <div className="text-[11px] text-red-300">Not enough gil — you have {fmtGil(gil)}.</div>}
          {note && <div className="text-[11px] text-amber-300">{note}</div>}

          <div className="flex items-center gap-2 pt-1">
            <button onClick={close} className="px-3 py-2 text-[12px] font-semibold rounded-md border border-line text-fg-3 hover:text-fg transition-colors">Cancel</button>
            <button
              onClick={() => { if (addToCart(entryFromRow(row, qty))) close(); else setNote(`Single ${row.n} is capped at one stack in the buy list.`); }}
              className="le-tap px-3 py-2 text-[12px] font-semibold rounded-md border border-line bg-field text-fg-2 hover:bg-surface-hover transition-colors"
            >
              {inCart ? 'Update List' : 'Add to List'}
            </button>
            <button
              onClick={() => { bzBuy(conn, { sellerid: row.sellerId, sellerindex: row.sellerIndex, bidx: row.bidx, id: row.id, price: row.price, qty }); close(); }}
              disabled={!afford}
              className="le-tap ml-auto px-4 py-2 text-[12px] font-bold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors"
            >
              Buy Now
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

type ProcStatus = 'pending' | 'buying' | 'done' | 'failed';

function CartModal({ conn, gil, assets, iconSet, onClose }: { conn: number; gil: number; assets?: string; iconSet: Set<number>; onClose: () => void }) {
  const cart = useCart();
  const [status, setStatus] = useState<Record<string, ProcStatus>>({});
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);

  const total = cart.reduce((s, e) => s + e.price * e.qty, 0);
  const units = cart.reduce((s, e) => s + e.qty, 0);
  const afford = gil >= total;
  const canMaxAll = cart.some((e) => e.qty < e.maxQty);
  const maxAll = () => { for (const e of getCart()) if (e.qty < e.maxQty) setCartQty(e.key, e.maxQty); };

  const run = async () => {
    const entries = getCart();
    if (entries.length === 0) return;
    setRunning(true); setFinished(false);
    const st: Record<string, ProcStatus> = {};
    entries.forEach((e) => { st[e.key] = 'pending'; });
    setStatus({ ...st });
    for (const e of entries) {
      st[e.key] = 'buying'; setStatus({ ...st });
      bzBuy(conn, { sellerid: e.sellerId, sellerindex: e.sellerIndex, bidx: e.bidx, id: e.id, price: e.price, qty: e.qty });
      const res = await nextBzBuy();
      st[e.key] = res?.ok ? 'done' : 'failed'; setStatus({ ...st });
      await new Promise((r) => setTimeout(r, 450));
    }
    for (const e of entries) if (st[e.key] === 'done') removeFromCart(e.key);
    setRunning(false); setFinished(true);
  };

  const dot = (s?: ProcStatus) =>
    s === 'done' ? 'bg-emerald-400' : s === 'failed' ? 'bg-red-400' : s === 'buying' ? 'bg-accent animate-pulse' : 'bg-fg-4';

  return (
    <Modal onClose={running ? () => {} : onClose} backdropClose={!running} panelClass="w-[min(94vw,460px)] max-h-[82vh]">
      {(close) => (
        <div className="flex flex-col min-h-0">
          <div className="flex items-center gap-2 px-4 pt-4 pb-2 shrink-0">
            <span className="text-[14px] font-bold text-fg">Buy List</span>
            <span className="text-[11px] text-fg-4 tabular-nums">{cart.length} listing{cart.length === 1 ? '' : 's'} · {units} item{units === 1 ? '' : 's'}</span>
            {cart.length > 0 && !running && (
              <div className="ml-auto flex items-center gap-2.5">
                <Button variant="ghost" size="xs" onClick={maxAll} disabled={!canMaxAll}>Max All</Button>
                <Button variant="ghost" size="xs" onClick={() => { clearCart(); setStatus({}); setFinished(false); }}>Clear</Button>
              </div>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-4 divide-y divide-line">
            {cart.length === 0 ? (
              <div className="text-[12px] text-fg-4 text-center py-8">{finished ? 'All purchases processed.' : 'Your buy list is empty.'}</div>
            ) : (
              <AnimatePresence mode="popLayout" initial={false}>
              {cart.map((e) => {
              const st = status[e.key];
              return (
                <motion.div
                  key={e.key}
                  layout
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  className="flex items-center gap-2.5 py-2.5"
                >
                  {(running || finished) && <span className={`shrink-0 w-2 h-2 rounded-full ${dot(st)}`} title={st} />}
                  <Icon id={e.id} n={e.n} assets={assets} iconSet={iconSet} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-semibold text-fg truncate">{e.n}</div>
                    <div className="text-[10px] text-fg-4 tabular-nums truncate">{fmtGil(e.price)} gil ea · {e.seller}{st === 'failed' ? ' · failed' : ''}</div>
                  </div>
                  {running || finished ? (
                    <span className="shrink-0 text-[12px] font-bold tabular-nums text-fg-3">×{e.qty}</span>
                  ) : (
                    <Stepper value={e.qty} min={1} max={e.maxQty} onChange={(v) => setCartQty(e.key, v)} className="shrink-0" />
                  )}
                  <span className="shrink-0 w-20 text-right text-[12px] font-semibold tabular-nums text-fg-2">{fmtGil(e.price * e.qty)}</span>
                  {!running && !finished && (
                    <button onClick={() => removeFromCart(e.key)} aria-label="Remove" className="shrink-0 grid place-items-center w-6 h-6 rounded text-fg-4 hover:text-red-400 hover:bg-line transition-colors">×</button>
                  )}
                </motion.div>
              );
            })}
              </AnimatePresence>
            )}
          </div>

          <div className="shrink-0 border-t border-line p-4 flex items-center gap-3">
            <div className="text-[12px] text-fg-3">Total <span className={`text-[15px] font-extrabold tabular-nums ${afford ? 'text-amber-300' : 'text-red-300'}`}>{fmtGil(total)}</span> <span className="text-fg-4">gil</span></div>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={close} disabled={running} className="px-3 py-2 text-[12px] font-semibold rounded-md border border-line text-fg-3 enabled:hover:text-fg disabled:opacity-40 transition-colors">{finished ? 'Close' : 'Cancel'}</button>
              {cart.length > 0 && (
                <button onClick={run} disabled={running || !afford} className="le-tap px-4 py-2 text-[12px] font-bold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors">
                  {running ? 'Buying…' : `Buy All · ${fmtGil(total)} gil`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function BlacklistModal({ sellerNames, onClose }: { sellerNames: string[]; onClose: () => void }) {
  const list = useBzBlacklist();
  const [q, setQ] = useState('');
  const blockedSet = useMemo(() => new Set(list.map((n) => n.toLowerCase())), [list]);
  const add = (name?: string) => { const n = (name ?? q).trim(); if (n) { addBzBlacklist(n); setQ(''); } };
  const candidates = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const seen = new Set<string>();
    const out: string[] = [];
    for (const n of sellerNames) {
      const key = n.toLowerCase();
      if (seen.has(key) || blockedSet.has(key)) continue;
      if (ql && !key.includes(ql)) continue;
      seen.add(key); out.push(n);
    }
    return out.sort((a, b) => a.localeCompare(b));
  }, [sellerNames, blockedSet, q]);
  return (
    <Modal onClose={onClose} panelClass="w-[min(94vw,380px)] max-h-[80vh]">
      <div className="p-4 flex flex-col gap-3">
        <div className="text-[14px] font-bold text-fg">Blacklisted Sellers</div>
        <div className="flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            placeholder="Player name"
            className="flex-1 bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50"
          />
          <button onClick={() => add()} disabled={!q.trim()} className="px-3 py-1.5 text-[12px] font-bold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors">Add</button>
        </div>
        {candidates.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="text-[10px] font-bold tracking-wide text-fg-4 uppercase">Nearby Bazaars</div>
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
              {candidates.map((n) => (
                <button key={n} onClick={() => add(n)} title={`Blacklist ${n}`} className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-full border border-line bg-field text-fg-2 hover:border-red-400/50 hover:text-red-200 hover:bg-red-500/10 transition-colors">
                  <span className="truncate max-w-[130px]">{n}</span>
                  <svg viewBox="0 0 24 24" className="w-3 h-3 text-fg-4" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="text-[10px] font-bold tracking-wide text-fg-4 uppercase">Blocked{list.length ? ` · ${list.length}` : ''}</div>
        {list.length === 0 ? (
          <div className="text-center text-[12px] text-fg-4 py-3">No Sellers Blocked</div>
        ) : (
          <div className="rounded-lg border border-line bg-surface overflow-hidden divide-y divide-line max-h-52 overflow-y-auto">
            {list.map((n) => (
              <div key={n} className="flex items-center gap-2 px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[12px] text-fg-2">{n}</span>
                <button onClick={() => removeBzBlacklist(n)} aria-label="Unblock" className="shrink-0 grid place-items-center w-5 h-5 rounded text-fg-4 hover:text-fg hover:bg-line transition-colors">×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

type SortKey = 'price' | 'priceDesc' | 'name' | 'dist' | 'seller';
const SORTS: { v: SortKey; label: string }[] = [
  { v: 'price', label: 'Price' }, { v: 'priceDesc', label: 'Price ↓' }, { v: 'name', label: 'Name' }, { v: 'dist', label: 'Distance' }, { v: 'seller', label: 'Seller' },
];

function BrowsePanel({ conn, sellers, listings, scan, mem, gil, assets, iconSet }: { conn: number; sellers: BazaarSeller[]; listings: Record<number, BazaarListing>; scan?: BazaarScan; mem: boolean; gil: number; assets?: string; iconSet: Set<number> }) {
  const [arrange, setArrange] = useSticky<'item' | 'seller'>('bz.arrange', 'item');
  const [sort, setSort] = useSticky<SortKey>('bz.sort', 'price');
  const [search, setSearch] = useSticky('bz.search', '');
  const [affordable, setAffordable] = useSticky('bz.afford', false);
  const [buying, setBuying] = useState<Row | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const cart = useCart();
  const cartKeys = useMemo(() => new Set(cart.map((c) => c.key)), [cart]);
  const cartTotal = cart.reduce((s, e) => s + e.price * e.qty, 0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  useEffect(() => { bzRange(conn, SCAN_RANGE); }, [conn]);
  const blacklist = useBzBlacklist();
  const blocked = useMemo(() => new Set(blacklist.map((n) => n.toLowerCase())), [blacklist]);
  const nearby = useMemo(() => sellers.filter((s) => !blocked.has(s.name.toLowerCase())), [sellers, blocked]);
  const sellerNames = useMemo(() => sellers.map((s) => s.name), [sellers]);
  const [blOpen, setBlOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 3500); return () => clearTimeout(t); }, [notice]);

  const byId = useMemo(() => new Map(sellers.map((s) => [s.id, s])), [sellers]);

  const rows = useMemo<Row[]>(() => {
    const min: Record<number, number> = {};
    const count: Record<number, number> = {};
    const all: Row[] = [];
    for (const listing of Object.values(listings)) {
      if (blocked.has(listing.seller.toLowerCase())) continue;
      const s = byId.get(listing.sellerId);
      for (const it of listing.items) {
        if (min[it.id] === undefined || it.price < min[it.id]) min[it.id] = it.price;
        count[it.id] = (count[it.id] ?? 0) + 1;
        all.push({ sellerId: listing.sellerId, seller: listing.seller, sellerIndex: listing.sellerIndex, bidx: it.bidx, id: it.id, n: it.n, price: it.price, qty: it.qty, dist: s?.dist ?? 999, inrange: s?.inrange ?? false, cheapest: false, at: listing.at });
      }
    }
    for (const r of all) r.cheapest = count[r.id] > 1 && r.price === min[r.id];
    return all;
  }, [listings, byId, blocked]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (affordable && r.price > gil) return false;
      if (!q) return true;
      return itemNameMatches(r.id, r.n, q) || r.seller.toLowerCase().includes(q);
    });
  }, [rows, search, affordable, gil]);

  const sorted = useMemo(() => {
    const a = [...filtered];
    a.sort((x, y) => {
      switch (sort) {
        case 'price': return x.price - y.price;
        case 'priceDesc': return y.price - x.price;
        case 'name': return x.n.localeCompare(y.n) || x.price - y.price;
        case 'dist': return x.dist - y.dist || x.price - y.price;
        case 'seller': return x.seller.localeCompare(y.seller) || x.price - y.price;
      }
    });
    return a;
  }, [filtered, sort]);

  const groups = useMemo(() => {
    const m = new Map<number, { sellerId: number; seller: string; sellerIndex: number; dist: number; inrange: boolean; at: number; rows: Row[] }>();
    for (const r of sorted) {
      let g = m.get(r.sellerId);
      if (!g) { g = { sellerId: r.sellerId, seller: r.seller, sellerIndex: r.sellerIndex, dist: r.dist, inrange: r.inrange, at: r.at, rows: [] }; m.set(r.sellerId, g); }
      g.rows.push(r);
    }
    return [...m.values()].sort((a, b) => a.dist - b.dist);
  }, [sorted]);

  const scanning = !!scan?.active;
  const newestAt = useMemo(() => Math.max(0, ...Object.values(listings).map((l) => l.at)), [listings]);
  const sellerMatchNote = search.trim() && arrange === 'seller' ? ` · ${groups.length} of ${Object.keys(listings).length} sellers match` : '';

  return (
    <>
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-1.5 text-[11px] min-w-0">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${nearby.length ? 'bg-emerald-400' : 'bg-fg-4'}`} />
          <span className={`truncate ${nearby.length ? 'text-emerald-300' : 'text-fg-4'}`}>{nearby.length ? `${nearby.length} Bazaar${nearby.length === 1 ? '' : 's'} ${mem ? 'Detected Nearby' : 'Known'}` : (mem ? 'No bazaars nearby.' : 'No bazaars known. Walk up to detect, or Deep Scan.')}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={() => setBlOpen(true)} title="Blacklisted sellers" className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold rounded-md border transition-colors ${blacklist.length ? 'border-red-400/50 bg-red-500/15 text-red-200 hover:bg-red-500/25' : 'border-line-2 bg-field text-fg-2 hover:text-fg hover:border-accent/50'}`}>
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></svg>
            Blacklist
            {blacklist.length > 0 && <span className="grid place-items-center min-w-[16px] h-4 px-1 rounded-full bg-red-400 text-[10px] font-extrabold tabular-nums text-[#2a0000]">{blacklist.length}</span>}
          </button>
          <button onClick={() => bzScan(conn)} disabled={scanning || nearby.length === 0} title={nearby.length === 0 ? 'No bazaars nearby' : undefined} className="px-3 py-1.5 text-[12px] font-bold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors">Scan Nearby</button>
          {!mem && <button onClick={() => bzDeepScan(conn)} disabled={scanning} title="Check every nearby player for a bazaar" className="px-2.5 py-1.5 text-[11px] font-semibold rounded-md border border-line bg-field text-fg-3 hover:text-fg disabled:opacity-40 transition-colors">Deep Scan</button>}
        </div>
      </div>
      {scan && scanning && <ScanBar scan={scan} onStop={() => bzScanStop(conn)} />}
      <Collapse open={!!notice}>{notice && <div className="mb-3 px-3 py-2 rounded-lg text-[11px] font-semibold border bg-amber-500/15 border-amber-500/40 text-amber-200">{notice}</div>}</Collapse>

      {rows.length === 0 ? (
        <div className="text-[12px] text-fg-4 text-center py-10">{scanning ? 'Reading bazaars…' : 'Scan to compile listings from nearby bazaars.'}</div>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <SearchInput
              value={search}
              onChange={setSearch}
              wrap="flex-1 min-w-[140px]"
              placeholder="Search item or seller"
              className="bg-field border border-line rounded-md px-2.5 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50"
            />
            <Segmented value={arrange} onChange={setArrange} options={[{ v: 'item', label: 'By Item' }, { v: 'seller', label: 'By Seller' }]} />
          </div>
          <div className="mb-2">
            <Segmented value={sort} onChange={setSort} options={SORTS} full />
          </div>
          <div className="flex items-center gap-2 mb-3">
            <button onClick={() => setAffordable((a) => !a)} className={`px-2.5 py-1.5 text-[11px] font-semibold rounded-md border transition-colors ${affordable ? 'bg-accent/15 border-accent/40 text-accent' : 'bg-field border-line text-fg-3 hover:text-fg-2'}`}>Affordable</button>
            <span className="text-[10px] text-fg-4 ml-auto tabular-nums">{sorted.length} items{newestAt ? ` · scanned ${agoLabel(newestAt, now)}` : ''}{sellerMatchNote}</span>
          </div>

          {arrange === 'item' ? (
            <div className="rounded-xl bg-surface border border-line divide-y divide-line">
              <AnimatePresence mode="popLayout" initial={false}>
                {sorted.map((r) => (
                  <motion.div key={`${r.sellerId}-${r.bidx}`} layout initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}>
                    <ItemRow row={r} assets={assets} iconSet={iconSet} inCart={cartKeys.has(cartKey(r.sellerId, r.bidx))} onBuy={() => setBuying(r)} onAddList={() => { if (!addToCart(entryFromRow(r, 1))) setNotice(`Single ${r.n} is capped at one stack in the buy list.`); }} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          ) : (
            <div className="space-y-3">
              {groups.map((g) => (
                <Group
                  key={g.sellerId}
                  title={`${g.seller} · ${g.dist.toFixed(0)}y${!g.inrange ? ' (out of range)' : ''} · ${g.rows.length}`}
                  right={
                    <div className="flex items-center gap-2">
                      {g.at > 0 && <span className="text-[10px] text-fg-4">{agoLabel(g.at, now)}</span>}
                      <button onClick={() => bzOpen(conn, g.sellerId, g.sellerIndex)} disabled={!g.inrange} title={g.inrange ? undefined : 'Seller is out of range'} className="px-2 py-1 text-[10px] font-semibold rounded-md border border-line bg-field text-fg-3 enabled:hover:text-fg disabled:opacity-40 transition-colors">Refresh</button>
                      <button onClick={() => addBzBlacklist(g.seller)} title="Hide this seller from results" className="px-2 py-1 text-[10px] font-semibold rounded-md border border-line bg-field text-fg-3 hover:text-red-300 hover:border-red-400/40 transition-colors">Block</button>
                    </div>
                  }
                >
                  <div className="divide-y divide-line -mx-1">
                    <AnimatePresence mode="popLayout" initial={false}>
                      {g.rows.map((r) => (
                        <motion.div key={`${r.sellerId}-${r.bidx}`} layout initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}>
                          <ItemRow row={r} assets={assets} iconSet={iconSet} inCart={cartKeys.has(cartKey(r.sellerId, r.bidx))} onBuy={() => setBuying(r)} onAddList={() => { if (!addToCart(entryFromRow(r, 1))) setNotice(`Single ${r.n} is capped at one stack in the buy list.`); }} />
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </Group>
              ))}
            </div>
          )}
        </>
      )}

      <AnimatePresence initial={false}>
        {cart.length > 0 && (
          <motion.div
            key="cartbar"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="sticky bottom-0 -mx-4 mt-3 px-4 py-2.5 bg-[var(--color-bg)] border-t-2 border-accent shadow-[0_-10px_28px_-6px_rgba(0,0,0,0.8)] flex items-center gap-3"
          >
            <span className="text-[12px] text-fg-2"><span className="font-bold tabular-nums">{cart.length}</span> in buy list · <span className="font-bold tabular-nums text-amber-300">{fmtGil(cartTotal)}</span> <span className="text-fg-4">gil</span></span>
            <button onClick={() => setCartOpen(true)} className="le-tap ml-auto px-4 py-1.5 text-[12px] font-bold rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors">Review &amp; Buy</button>
          </motion.div>
        )}
      </AnimatePresence>

      {buying && <BuyModal conn={conn} row={buying} gil={gil} assets={assets} iconSet={iconSet} onClose={() => setBuying(null)} />}
      {cartOpen && <CartModal conn={conn} gil={gil} assets={assets} iconSet={iconSet} onClose={() => setCartOpen(false)} />}
      {blOpen && <BlacklistModal sellerNames={sellerNames} onClose={() => setBlOpen(false)} />}
    </>
  );
}

export default function BazaarView() {
  const known = useKnownCharacters();
  const online = known.filter((k) => k.online && k.conn != null);
  const [name, setName] = useStickyChar();
  const active = online.find((k) => k.name === name) ?? online[0];
  useEffect(() => { if (active && active.name !== name) setName(active.name); }, [active, name]);
  const [tab, setTab] = useSticky<'my' | 'browse'>('bz.tab', 'my');
  const exp = useSettings().experimentalFeatures;
  const effTab = exp ? tab : 'my';
  const iconSet = useAvailableIcons();
  const server = useSettings().ahServer || active?.server || online.find((k) => k.server)?.server;

  useEffect(() => {
    const c = active?.conn;
    if (c == null) return;
    bzWatch(c, effTab === 'browse');
    return () => bzWatch(c, false);
  }, [active?.conn, effTab]);

  const buy = useBzBuy();
  const [buyMsg, setBuyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (!buy || buy.conn !== active?.conn) return;
    setBuyMsg({ ok: buy.ok, text: buy.ok ? `Bought from ${buy.name}` : `Could not buy from ${buy.name}: ${buy.reason}` });
    const t = setTimeout(() => setBuyMsg(null), 4000);
    return () => clearTimeout(t);
  }, [buy?.at]);

  if (online.length === 0) {
    return (
      <div className="h-full grid place-items-center">
        <div className="text-center max-w-sm">
          <div className="text-[15px] font-bold text-fg mb-1">No Connected Characters</div>
          <div className="text-[12px] text-fg-4 leading-relaxed">Bazaars are read live in-game. Load the Alexandria addon in-game to manage and browse bazaars here.</div>
        </div>
      </div>
    );
  }

  const conn = active?.conn;

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-4 pt-4 pb-3 border-b border-line flex flex-col gap-2.5">
        {online.length > 1 && <CharacterSelect value={active?.name ?? ''} onChange={setName} chars={online} />}
        <SectionTabs value={effTab} onChange={setTab} tabs={exp ? [{ id: 'my', label: 'My Bazaar' }, { id: 'browse', label: 'Browse' }] : [{ id: 'my', label: 'My Bazaar' }]} />
      </div>
      <AnimatePresence initial={false}>
        {buyMsg && (
          <motion.div
            key="buymsg"
            initial={{ opacity: 0, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, height: 'auto', marginTop: 12 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className={`shrink-0 mx-4 px-3 py-2 rounded-lg text-[12px] font-semibold border overflow-hidden ${buyMsg.ok ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200' : 'bg-red-500/15 border-red-500/40 text-red-200'}`}
          >
            {buyMsg.text}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {conn != null && (
          <Crossfade id={effTab}>{effTab === 'my'
            ? <MyBazaarPanel conn={conn} items={active?.bzMy ?? []} server={server} assets={active?.assets} iconSet={iconSet} />
            : <BrowsePanel conn={conn} sellers={active?.bzSellers ?? []} listings={active?.bzListings ?? {}} scan={active?.bzScan} mem={!!active?.bzMem} gil={active?.gil ?? 0} assets={active?.assets} iconSet={iconSet} />}</Crossfade>
        )}
      </div>
    </div>
  );
}
