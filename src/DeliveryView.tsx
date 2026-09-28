import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useKnownCharacters, useAvailableIcons, dboxOpen, dboxClose, dboxTake, dboxReturn, dboxSendMany, dboxSendGil, GIL_MAIL_CAP, dboxCancel, NOMAD_BAGS, inNomadZone, nomadReachable, type KnownChar, type DboxSlot, type InvItem, type DboxSendItem } from './bridge';
import { IconInner } from './atlasIcon';
import { useItemHover } from './ItemTooltip';
import { itemNameMatches } from './itemNames';
import { CharacterSelect, Segmented, Stepper, GilInput, BagTag, SearchInput, Toggle } from './ui';
import { Modal, Collapse, Popover } from './overlay';
import { GilIcon } from './GilIcon';
import { useStickyChar, useSticky } from './sticky';
import { useSettings } from './settings';
import { useAnon } from './anonymize';
import { OpCard } from './OpCard';
import { ALWAYS_BAGS, MOG_ONLY_BAGS as MOG_BAGS, FLAG_RARE, FLAG_NOSEND, FLAG_POLSEND } from './bagConstants';

const NO_SEND = FLAG_NOSEND;
const isPolSend = (it: InvItem) => ((it.f ?? 0) & FLAG_POLSEND) !== 0;
// Augmented gear is bound to the character once augments are applied -- it can no longer
// be mailed even if the base item is sendable. Exclude anything carrying augments. When `pol`
// is on, an item flagged Can-Send-POL is offered even though it is Rare/Ex (No-Delivery) -- the
// server permits it ONLY to characters on the same POL account, and bounces it back otherwise.
const sendable = (it: InvItem, pol: boolean) => {
  if (it.aug && it.aug.length > 0) return false;
  if (!((it.f ?? 0) & NO_SEND)) return true;
  return pol && isPolSend(it);
};

function reachableBag(bagId: number, nomadOk: boolean, mog: boolean) {
  if (ALWAYS_BAGS.has(bagId)) return true;
  if (mog && MOG_BAGS.has(bagId)) return true;
  if (NOMAD_BAGS.has(bagId)) return nomadOk;
  return false;
}

// Bag display order in the mail picker: inventory, carry bags, then storage, then wardrobes.
const BAG_PICK_ORDER = [0, 5, 6, 7, 1, 9, 2, 4, 8, 10, 11, 12, 13, 14, 15, 16];
const bagPickRank = (id: number) => { const i = BAG_PICK_ORDER.indexOf(id); return i < 0 ? 99 : i; };
// Bulk storage + wardrobes start collapsed so the picker isn't a wall of items.
const DEFAULT_COLLAPSED_BAGS = new Set([1, 2, 4, 8, 9, 10, 11, 12, 13, 14, 15, 16]);

function Icon({ id, n, c, assets, iconSet, size = 32 }: { id: number; n: string; c?: number; assets?: string; iconSet: Set<number>; size?: number }) {
  const hover = useItemHover({ id, n, c });
  return (
    <div {...hover} className="relative shrink-0 rounded bg-field grid place-items-center overflow-hidden" style={{ width: size, height: size }}>
      <IconInner id={id} size={size} name={n} assets={assets} bmpHas={id > 0 && iconSet.has(id)} />
    </div>
  );
}

function fmtDate(ts: number) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function relTime(ts: number) {
  if (!ts) return '';
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Color the recency by how long an item has been sitting in the box.
function recencyTone(ts: number) {
  if (!ts) return 'text-fg-4';
  const s = Date.now() / 1000 - ts;
  if (s < 86400) return 'text-emerald-300';
  if (s < 7 * 86400) return 'text-sky-300';
  if (s < 30 * 86400) return 'text-amber-300';
  return 'text-rose-300';
}

const ICON_IN = <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /><path d="M12 3.5v5" /><path d="m9.8 6.4 2.2 2.2 2.2-2.2" /></svg>;
const ICON_OUT = <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /><path d="M12 8.5v-5" /><path d="m9.8 5.6 2.2-2.2 2.2 2.2" /></svg>;

function SlotRow({ slot, kind, assets, iconSet, selectable, selected, onPointerDown, onPointerEnter }: { slot?: DboxSlot; kind: 'in' | 'out'; assets?: string; iconSet: Set<number>; selectable?: boolean; selected?: boolean; onPointerDown?: () => void; onPointerEnter?: () => void }) {
  const anon = useAnon();
  if (!slot) {
    return (
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-line bg-field/40">
        <div className="w-8 h-8 rounded bg-field/60 shrink-0" />
        <span className="text-[12px] text-fg-4">Empty</span>
      </div>
    );
  }
  const body = (
    <>
      {slot.gil ? (
        <div className="relative shrink-0 w-10 h-10 grid place-items-center"><GilIcon size={36} /></div>
      ) : (
        <Icon id={slot.id} n={slot.n} assets={assets} iconSet={iconSet} size={40} />
      )}
      <div className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-fg truncate">{slot.n}</span>
          {slot.gil
            ? <span className="shrink-0 text-[11px] font-bold tabular-nums px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-300">{slot.c.toLocaleString()} gil</span>
            : slot.c > 1 && <span className="shrink-0 text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded bg-accent/15 text-accent">×{slot.c}</span>}
        </div>
        {slot.who && (
          <div className="text-[11px] text-fg-4 truncate mt-0.5">
            {kind === 'in' ? 'From' : 'To'} <span className="font-semibold text-fg-3">{anon(slot.who)}</span>
          </div>
        )}
      </div>
      {slot.ts > 0 && (
        <div className="shrink-0 text-right">
          <div className="text-[10px] text-fg-4 tabular-nums">{fmtDate(slot.ts)}</div>
          <div className={`text-[13px] font-bold tabular-nums ${recencyTone(slot.ts)}`}>{relTime(slot.ts)}</div>
        </div>
      )}
    </>
  );
  if (!selectable) {
    return <div className="flex items-center gap-3 px-3 py-3 rounded-lg border border-line bg-surface-raised">{body}</div>;
  }
  return (
    <button
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
      className={`w-full select-none flex items-center gap-3 px-3 py-3 rounded-lg border transition-colors ${selected ? 'border-accent bg-accent/10' : 'border-line bg-surface-raised hover:border-fg-4'}`}
    >
      {body}
    </button>
  );
}

function BoxPanel({ slots, kind, assets, iconSet, selectable, selected, onSelDown, onSelEnter }: { slots: DboxSlot[]; kind: 'in' | 'out'; assets?: string; iconSet: Set<number>; selectable?: boolean; selected?: Set<number>; onSelDown?: (s: number) => void; onSelEnter?: (s: number) => void }) {
  const bySlot = useMemo(() => {
    const m = new Map<number, DboxSlot>();
    for (const it of slots) m.set(it.s, it);
    return m;
  }, [slots]);
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <div className="flex flex-col gap-1.5">
        {Array.from({ length: 8 }, (_, i) => {
          const s = bySlot.get(i);
          return (
            <SlotRow
              key={i}
              slot={s}
              kind={kind}
              assets={assets}
              iconSet={iconSet}
              selectable={selectable && !!s}
              selected={!!s && selected?.has(i)}
              onPointerDown={s && onSelDown ? () => onSelDown(i) : undefined}
              onPointerEnter={s && onSelEnter ? () => onSelEnter(i) : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

type Picked = { key: string; id: number; bag: number; slot: number; n: string; max: number; count: number; pol?: boolean };

function RecipientCombo({ value, onChange, chars }: { value: string; onChange: (v: string) => void; chars: KnownChar[] }) {
  const anon = useAnon();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => {
    const s = value.trim().toLowerCase();
    return chars.filter((c) => !s || (c.name.toLowerCase().includes(s) && c.name.toLowerCase() !== s));
  }, [chars, value]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Recipient character name"
        className="w-full bg-field border border-line rounded-md px-3 py-2 text-[13px] text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 transition-colors"
      />
      <Popover open={open && matches.length > 0} anchor={ref} className="rounded-md border border-line bg-popover shadow-xl max-h-52 overflow-y-auto py-1">
          {matches.map((c) => (
            <button
              key={c.name}
              onMouseDown={(e) => { e.preventDefault(); onChange(c.name); setOpen(false); }}
              className="le-tap w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] text-fg-2 hover:bg-line transition-colors"
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.online ? 'bg-emerald-400' : 'bg-fg-4'}`} />
              <span className="truncate">{anon(c.name)}</span>
            </button>
          ))}
        </Popover>
    </div>
  );
}

function MailModal({ char, recipients, iconSet, onClose }: { char: KnownChar; recipients: KnownChar[]; iconSet: Set<number>; onClose: () => void }) {
  const anon = useAnon();
  const conn = char.conn;
  const [target, setTarget] = useState('');
  const [q, setQ] = useState('');
  const [polSend, setPolSend] = useSticky('dbox.polsend', false);
  const [picked, setPicked] = useState<Picked[]>([]);
  const haveGil = char.gil ?? 0;
  const gilCap = Math.min(GIL_MAIL_CAP, haveGil);
  const [gilAmt, setGilAmt] = useState(0);
  const nomadOk = nomadReachable(char, useSettings().experimentalFeatures);
  // Each mailed item (and a gil parcel) takes one outbox slot; the outbox holds 8 minus
  // whatever already occupies it. Don't let the user stage more than will fit.
  const outFree = Math.max(0, 8 - (char.dbox?.out?.length ?? 0));
  const parcels = picked.length + (gilAmt > 0 ? 1 : 0);
  const full = parcels >= outFree;
  const setGil = (v: number) => {
    const want = Math.max(0, Math.min(gilCap, Math.floor(v) || 0));
    if (want > 0 && gilAmt === 0 && picked.length >= outFree) return; // no slot left for a gil parcel
    setGilAmt(want);
  };

  const searching = q.trim().length > 0;
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set(DEFAULT_COLLAPSED_BAGS));
  const toggleBag = (id: number) => setCollapsed((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const bagOpen = (id: number) => searching || !collapsed.has(id);

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const mog = !!char.mog;
    const out: { id: number; name: string; items: { id: number; bag: number; bagName: string; slot: number; n: string; c: number; pol: boolean }[] }[] = [];
    for (const bag of char.inv ?? []) {
      if (!reachableBag(bag.id, nomadOk, mog)) continue;
      const items = [];
      for (const it of bag.items) {
        if (!sendable(it, polSend)) continue;
        if (s && !itemNameMatches(it.id, it.n, s)) continue;
        items.push({ id: it.id, bag: bag.id, bagName: bag.b, slot: it.s, n: it.n, c: it.c, pol: polSend && isPolSend(it) && !!((it.f ?? 0) & NO_SEND) });
      }
      if (items.length) out.push({ id: bag.id, name: bag.b, items });
    }
    out.sort((a, b) => bagPickRank(a.id) - bagPickRank(b.id));
    return out;
  }, [char.inv, char.mog, nomadOk, q, polSend]);
  const poolCount = useMemo(() => groups.reduce((n, g) => n + g.items.length, 0), [groups]);

  const pickedKeys = useMemo(() => new Set(picked.map((p) => p.key)), [picked]);
  const add = (x: { id: number; bag: number; slot: number; n: string; c: number; pol?: boolean }) => {
    const key = `${x.bag}:${x.slot}`;
    if (pickedKeys.has(key)) { setPicked((p) => p.filter((y) => y.key !== key)); return; }
    if (full) return; // outbox can't hold another parcel
    setPicked((p) => [...p, { key, id: x.id, bag: x.bag, slot: x.slot, n: x.n, max: x.c, count: x.c, pol: x.pol }]);
  };
  const setCount = (key: string, count: number) => setPicked((p) => p.map((y) => (y.key === key ? { ...y, count } : y)));
  const remove = (key: string) => setPicked((p) => p.filter((y) => y.key !== key));

  const name = target.trim();
  const ok = conn != null && name.length >= 3 && parcels > 0 && parcels <= outFree;
  const send = () => {
    if (!ok || conn == null) return;
    if (picked.length > 0) {
      const items: DboxSendItem[] = picked.map((p) => ({ id: p.id, bag: p.bag, slot: p.slot, count: Math.max(1, Math.min(p.count, p.max)), target: name }));
      dboxSendMany(conn, items);
    }
    if (gilAmt > 0) dboxSendGil(conn, gilAmt, name);
    onClose();
  };

  return (
    <Modal onClose={onClose} panelClass="w-[min(94vw,520px)] max-h-[88vh] flex flex-col">
      {(close) => (
        <>
          <div className="shrink-0 flex items-center gap-2 px-4 pt-3.5 pb-2.5 border-b border-line">
            <div className="text-[14px] font-bold text-fg">Mail Items</div>
            <button onClick={close} aria-label="Close" className="le-tap ml-auto grid place-items-center w-7 h-7 rounded-md text-fg-4 hover:text-fg hover:bg-line transition-colors">
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>

          <div className="shrink-0 px-4 pt-3 flex flex-col gap-2">
            <RecipientCombo value={target} onChange={setTarget} chars={recipients} />
            <SearchInput
              value={q}
              onChange={setQ}
              wrap=""
              placeholder="Search items to send…"
              className="bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 transition-colors"
            />
            <div className={`flex items-start gap-2 rounded-md border px-2.5 py-2 transition-colors ${polSend ? 'border-amber-500/50 bg-amber-500/10' : 'border-line bg-field/40'}`}>
              <div className="min-w-0 flex-1">
                <div className={`text-[13px] font-semibold ${polSend ? 'text-amber-300' : 'text-fg-2'}`}>Enable POLSendable Items</div>
                <div className={`text-[12px] leading-snug ${polSend ? 'text-amber-300' : 'text-fg-4'}`}>Allows sending of POLSendable items. WARNING: This will only work with items sent to characters on the same POL account as the sender. USE CAREFULLY!</div>
              </div>
              <div className="shrink-0 pt-0.5"><Toggle on={polSend} onChange={setPolSend} /></div>
            </div>
            {haveGil > 0 && (
              <div className="flex items-center gap-2 rounded-md border border-line bg-field/40 px-2.5 py-1.5">
                <GilIcon size={22} />
                <span className="text-[12px] text-fg-2 flex-1">Gil</span>
                <GilInput value={gilAmt ? String(gilAmt) : ''} onChange={(d) => setGil(Number(d))} placeholder="0" className="w-28 bg-field border border-line rounded px-2 py-0.5 text-[12px] text-fg-2 text-right tabular-nums outline-none focus:border-accent/50" />
                <button onClick={() => setGil(gilCap)} disabled={gilAmt >= gilCap} className="le-tap px-1.5 h-6 rounded border border-line bg-field text-[10px] font-semibold text-fg-4 enabled:hover:text-fg disabled:opacity-30">Max</button>
                <span className="text-[10px] text-fg-5 tabular-nums shrink-0">/ {gilCap.toLocaleString()}</span>
              </div>
            )}
          </div>

          {picked.length > 0 && (
            <div className="shrink-0 px-4 pt-2.5 flex flex-col gap-1.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-fg-4">To Send · {parcels} / {outFree} slot{outFree === 1 ? '' : 's'}</div>
              {picked.map((p) => (
                <div key={p.key} className="flex items-center gap-2.5 rounded-md border border-accent/40 bg-accent/5 px-2.5 py-1.5">
                  <Icon id={p.id} n={p.n} assets={char.assets} iconSet={iconSet} size={24} />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-fg-2">{p.n}</span>
                  {p.pol && <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded bg-amber-500/20 text-amber-300 border border-amber-500/50" title="Rare/Ex: only deliverable to a character on the same POL account">
                    <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
                    POLSendable
                  </span>}
                  {p.max > 1 ? <Stepper value={p.count} min={1} max={p.max} onChange={(v) => setCount(p.key, v)} className="shrink-0" /> : <span className="text-[11px] text-fg-4 tabular-nums">×1</span>}
                  <button onClick={() => remove(p.key)} aria-label="Remove" className="shrink-0 grid place-items-center w-6 h-6 rounded-md text-fg-4 hover:text-fg hover:bg-line transition-colors">
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-2.5 pb-3 flex flex-col gap-2">
            {poolCount === 0 ? (
              <div className="text-center text-[12px] text-fg-4 py-8">No sendable items{q.trim() ? ' match your search' : ' in reachable bags'}.</div>
            ) : (
              groups.map((g) => {
                const open = bagOpen(g.id);
                return (
                  <div key={g.id} className="flex flex-col">
                    <button onClick={() => toggleBag(g.id)} className="le-tap flex items-center gap-2 px-1 py-1 text-left [&_*]:pointer-events-none">
                      <svg viewBox="0 0 24 24" className={`w-3 h-3 shrink-0 text-fg-4 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
                      <BagTag id={g.id} label={g.name} />
                      <span className="text-[11px] text-fg-4 tabular-nums">{g.items.length}</span>
                    </button>
                    <Collapse open={open}>
                      <div className="flex flex-col gap-1 pt-1 pl-1">
                        {g.items.map((x) => {
                          const key = `${x.bag}:${x.slot}`;
                          const on = pickedKeys.has(key);
                          const blocked = full && !on;
                          return (
                            <button
                              key={key}
                              onClick={() => add(x)}
                              disabled={blocked}
                              title={blocked ? 'Outbox is full' : undefined}
                              className={`w-full flex items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-left transition-colors ${on ? 'border-accent bg-accent/10' : blocked ? 'border-line bg-surface-raised opacity-40 cursor-not-allowed' : 'border-line bg-surface-raised hover:border-fg-4'}`}
                            >
                              <Icon id={x.id} n={x.n} assets={char.assets} iconSet={iconSet} size={24} />
                              <span className="min-w-0 flex-1 truncate text-[12px] text-fg-2">{x.n}</span>
                              {x.pol && <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded bg-amber-500/20 text-amber-300 border border-amber-500/50" title="Rare/Ex: only deliverable to a character on the same POL account">
                                <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
                                POLSendable
                              </span>}
                              {x.c > 1 && <span className="shrink-0 text-[10px] font-bold tabular-nums text-accent">×{x.c}</span>}
                            </button>
                          );
                        })}
                      </div>
                    </Collapse>
                  </div>
                );
              })
            )}
          </div>

          <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-t border-line">
            <span className={`text-[11px] ${full ? 'text-amber-300' : 'text-fg-4'}`}>
              {outFree === 0 ? 'Outbox is full' : `${name.length >= 3 ? `To ${anon(name)}` : 'Enter a recipient'} · ${parcels}/${outFree} slot${outFree === 1 ? '' : 's'}`}
            </span>
            <button onClick={close} className="le-tap ml-auto px-3 py-1.5 text-[12px] rounded-md border border-line text-fg-3 hover:text-fg-2 transition-colors">Cancel</button>
            <button onClick={send} disabled={!ok} className="le-tap px-4 py-1.5 text-[12px] font-semibold rounded-md bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-40 transition-colors">
              Send {parcels || ''}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

export default function DeliveryView() {
  const anon = useAnon();
  const known = useKnownCharacters();
  const iconSet = useAvailableIcons();
  const [name, setName] = useStickyChar();
  const [view, setView] = useState<'in' | 'out'>('in');
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [mail, setMail] = useState(false);
  const [cdLeft, setCdLeft] = useState(0);

  const online = useMemo(() => known.filter((c) => c.online && c.conn != null), [known]);
  const active: KnownChar | undefined = online.find((c) => c.name === name) ?? online[0];
  useEffect(() => { if (active && active.name !== name) setName(active.name); }, [active, name]);
  useEffect(() => { setSel(new Set()); }, [name, view]);

  const conn = active?.conn;
  const dbox = active?.dbox;
  const status = active?.dboxStatus;

  // Count of each id the character already holds across every bag (used for the Rare single-hold cap, same rule as
  // consolidate). Collected items land in inventory (bag 0), so Collect All must respect the same restrictions the
  // rest of the app does when moving items into a character:
  //   - Rare: a character may hold only ONE. Skip a Rare it already owns, and take at most one copy per Rare id in
  //     one batch (extra copies would be rejected by the server).
  //   - Inventory space: each parcel lands in its own inventory slot, so never schedule more than the free slots in
  //     bag 0 (the rest would fail / stay in the box). Gil parcels take no slot.
  const heldById = useMemo(() => {
    const m = new Map<number, number>();
    for (const b of active?.inv ?? []) for (const it of b.items) m.set(it.id, (m.get(it.id) ?? 0) + it.c);
    return m;
  }, [active?.inv]);
  const invFree = useMemo(() => {
    const b0 = active?.inv?.find((b) => b.id === 0);
    return b0 ? Math.max(0, b0.max - b0.used) : 0;
  }, [active?.inv]);
  const planCollect = (list: DboxSlot[]): number[] => {
    let free = invFree;
    const rareTaken = new Set<number>();
    const out: number[] = [];
    for (const it of list) {
      if (it.gil) { out.push(it.s); continue; } // gil merges into your purse, needs no slot
      if (free <= 0) break;                      // inventory full: nothing more will fit
      if ((it.f ?? 0) & FLAG_RARE) {
        if ((heldById.get(it.id) ?? 0) >= 1 || rareTaken.has(it.id)) continue; // already hold one / dup in batch
        rareTaken.add(it.id);
      }
      out.push(it.s);
      free -= 1;
    }
    return out;
  };
  const inCollect = useMemo(() => planCollect(dbox?.in ?? []), [dbox?.in, heldById, invFree]);
  const outCollect = useMemo(() => planCollect(dbox?.out ?? []), [dbox?.out, heldById, invFree]);

  useEffect(() => {
    const cd = status?.cooldown ?? 0;
    if (cd <= 0) { setCdLeft(0); return; }
    const endsAt = Date.now() + cd * 1000;
    const tick = () => setCdLeft(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
    tick();
    const h = window.setInterval(tick, 250);
    return () => window.clearInterval(h);
  }, [status?.cooldown, status?.opening]);

  const dragRef = useRef<{ add: boolean } | null>(null);
  const applyDrag = (slot: number, add: boolean) => setSel((prev) => {
    const next = new Set(prev);
    if (add) next.add(slot); else next.delete(slot);
    return next;
  });
  const onSelDown = (slot: number) => {
    const add = !sel.has(slot);
    dragRef.current = { add };
    applyDrag(slot, add);
    const end = () => { dragRef.current = null; window.removeEventListener('pointerup', end); };
    window.addEventListener('pointerup', end);
  };
  const onSelEnter = (slot: number) => { if (dragRef.current) applyDrag(slot, dragRef.current.add); };
  const clearSel = () => setSel(new Set());

  const act = () => {
    if (conn == null || sel.size === 0) return;
    const slots = [...sel].sort((a, b) => a - b);
    if (view === 'in') dboxTake(conn, slots); else dboxReturn(conn, slots);
    clearSel();
  };

  if (online.length === 0) {
    return (
      <div className="h-full grid place-items-center">
        <div className="text-center max-w-sm px-6">
          <div className="text-[15px] font-bold text-fg mb-1">No Characters Connected</div>
          <div className="text-[12px] text-fg-4 leading-relaxed">Log a character in-game with the Alexandria addon loaded to view its delivery box. The character must be in a Mog House, at an auction house, or at a Nomad Moogle (Selbina, Mhaura, Rabao, Kazham, Norg, Tavnazian Safehold, Nashmau).</div>
        </div>
      </div>
    );
  }

  const inboxUsed = dbox?.in.length ?? 0;
  const outboxUsed = dbox?.out.length ?? 0;
  const busy = !!status?.busy || (status?.queue ?? 0) > 0;
  const slots = view === 'in' ? (dbox?.in ?? []) : (dbox?.out ?? []);
  const canDeliver = !!(active?.atah ?? active?.ah?.atah) || inNomadZone(active?.zone) || !!active?.mog;
  const inOpen = view === 'in' && (status?.open === 'in' || !!status?.loading);

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-3 pt-3 pb-2 border-b border-line flex flex-col gap-2">
        <CharacterSelect value={active?.name ?? ''} onChange={setName} chars={online} />
        {canDeliver && (<>
        <Segmented
          full
          value={view}
          onChange={(v) => setView(v as 'in' | 'out')}
          options={[
            { v: 'in', label: `Inbox${inboxUsed ? ` ${inboxUsed}` : ''}` },
            { v: 'out', label: `Outbox${outboxUsed ? ` ${outboxUsed}` : ''}` },
          ]}
        />
        <div className="flex items-center gap-2">
          {(() => {
            const alreadyOpen = status?.open === view && !status?.opening;
            const btnCls = alreadyOpen
              ? 'bg-amber-400/15 text-amber-200 border border-amber-400/50 cursor-default'
              : status?.opening
                ? 'bg-emerald-600/70 text-white/90 border border-transparent cursor-default'
                : 'bg-emerald-600 text-white border border-transparent enabled:hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed';
            return (
              <button
                onClick={() => conn != null && (clearSel(), dboxOpen(conn, view))}
                disabled={conn == null || !!status?.opening || alreadyOpen}
                className={`flex-1 inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md text-[12px] font-bold transition-colors ${btnCls}`}
              >
                {status?.opening
                  ? <svg viewBox="0 0 24 24" className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.6" /></svg>
                  : alreadyOpen
                    ? <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                    : (view === 'in' ? ICON_IN : ICON_OUT)}
                {status?.opening ? (cdLeft > 0 ? `Opening in ${cdLeft}s` : 'Opening…') : alreadyOpen ? `${view === 'in' ? 'Inbox' : 'Outbox'} Open` : `Open ${view === 'in' ? 'Inbox' : 'Outbox'}`}
              </button>
            );
          })()}
          <button
            onClick={() => conn != null && dboxClose(conn)}
            title="Close Delivery Box"
            aria-label="Close Delivery Box"
            className="shrink-0 grid place-items-center w-9 h-9 rounded-md border border-line bg-field text-fg-3 hover:text-fg-2 hover:border-line-2 transition-colors"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        {conn != null && view === 'out' && (
          <button onClick={() => setMail(true)} className="le-tap inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md bg-accent text-on-accent text-[12px] font-bold hover:bg-accent-hover transition-colors">
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" /><path d="m3 6 9 7 9-7" /></svg>
            Mail Items
          </button>
        )}
        </>)}
      </div>

      {!canDeliver ? (
        <div className="flex-1 grid place-items-center text-center px-6">
          <div className="max-w-sm">
            <div className="text-[13px] font-semibold text-fg-2 mb-1">Not At A Delivery Box</div>
            <div className="text-[12px] text-fg-4 leading-relaxed">{active?.name ? anon(active.name) : 'This character'} must be in a Mog House, at an auction house, or at a Nomad Moogle (Selbina, Mhaura, Rabao, Kazham, Norg, Tavnazian Safehold, Nashmau) to use the delivery box.</div>
          </div>
        </div>
      ) : (<>

      <AnimatePresence>
        {(busy || status?.loading) && (
          <motion.div
            key="dboxbanner"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: 'hidden' }}
            className="shrink-0 px-3 pt-2"
          >
            <OpCard
              state="active"
              title={busy
                ? (status?.kind === 'send' ? 'Mailing items…' : status?.kind === 'take' ? 'Taking items…' : status?.kind === 'return' ? 'Returning items…' : 'Working…')
                : `Loading ${view === 'in' ? 'Inbox' : 'Outbox'} items…`}
              sublabel={busy ? undefined : `The ${view === 'in' ? 'inbox' : 'outbox'} will open/close several times ingame to populate.`}
              count={(status?.queue ?? 0) > 0 ? `${status?.queue} queued` : undefined}
              trailing={busy && conn != null ? (
                <button onClick={() => dboxCancel(conn)} className="le-tap shrink-0 px-2.5 py-1 text-[11px] font-semibold rounded-md border border-line text-fg-3 hover:text-fg hover:bg-field transition-colors">Cancel</button>
              ) : undefined}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 min-h-0 overflow-auto p-3">
        {!dbox && status?.loading ? (
          <div className="h-full grid place-items-center text-center px-6">
            <div className="flex flex-col items-center gap-3">
              <svg viewBox="0 0 24 24" className="w-7 h-7 animate-spin text-accent" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.6" /></svg>
              <div className="text-[12px] text-fg-4 leading-relaxed max-w-xs">Now loading {view === 'in' ? 'Inbox' : 'Outbox'} items. The {view === 'in' ? 'inbox' : 'outbox'} will open/close several times ingame to populate.</div>
            </div>
          </div>
        ) : !dbox ? (
          <div className="h-full grid place-items-center text-center px-6">
            <div className="max-w-sm">
              <div className="text-[13px] font-semibold text-fg-2 mb-1">Nothing Loaded Yet</div>
              <div className="text-[12px] text-fg-4 leading-relaxed">Click <span className="text-fg-2 font-semibold">Open {view === 'in' ? 'Inbox' : 'Outbox'}</span> while standing at a moogle or auction house to pop the box and load its contents.</div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {inOpen && inboxUsed > 0 && conn != null && (() => {
              const skipped = inboxUsed - inCollect.length;
              return (
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => { if (inCollect.length) { dboxTake(conn, inCollect); clearSel(); } }}
                    disabled={inCollect.length === 0}
                    title={inCollect.length === 0 ? 'Nothing collectable: inventory full, or every item is a Rare you already hold' : undefined}
                    className="le-tap inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md bg-accent text-on-accent text-[12px] font-bold hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M21 8v13H3V8" /><path d="M1 3h22v5H1z" /><path d="M10 12h4" /></svg>
                    Collect All ({inCollect.length})
                  </button>
                  {skipped > 0 && <div className="text-[10px] text-amber-300 text-center leading-snug">{skipped} skipped: Rare you already hold, or no inventory space.</div>}
                </div>
              );
            })()}
            {view === 'out' && (status?.open === 'out') && outboxUsed > 0 && conn != null && (() => {
              const skipped = outboxUsed - outCollect.length;
              return (
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => { if (outCollect.length) { dboxReturn(conn, outCollect); clearSel(); } }}
                    disabled={outCollect.length === 0}
                    title={outCollect.length === 0 ? 'Nothing collectable: inventory full, or every item is a Rare you already hold' : undefined}
                    className="le-tap inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md bg-accent text-on-accent text-[12px] font-bold hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 5 5v3" /></svg>
                    Collect All ({outCollect.length})
                  </button>
                  {skipped > 0 && <div className="text-[10px] text-amber-300 text-center leading-snug">{skipped} skipped: Rare you already hold, or no inventory space.</div>}
                </div>
              );
            })()}
            <BoxPanel
              slots={slots}
              kind={view}
              assets={active?.assets}
              iconSet={iconSet}
              selectable
              selected={sel}
              onSelDown={onSelDown}
              onSelEnter={onSelEnter}
            />
          </div>
        )}
      </div>

      <Collapse open={sel.size > 0} className="shrink-0">
        <div className="border-t-2 border-accent bg-[var(--color-bg)] shadow-[0_-10px_28px_-6px_rgba(0,0,0,0.8)] px-3 py-2.5 flex items-center gap-2">
          <span className="text-[12px] text-fg-2"><span className="font-bold text-accent tabular-nums">{sel.size}</span> selected</span>
          <button onClick={clearSel} className="le-tap ml-auto px-2.5 py-1 text-[11px] font-semibold rounded-md border border-line bg-field text-fg-3 hover:text-fg hover:border-line-2 transition-colors">Clear</button>
          <button onClick={act} className="le-tap px-3 py-2 text-[11px] font-bold rounded-md bg-accent text-on-accent border border-transparent hover:bg-accent-hover transition-colors">{view === 'in' ? 'Take' : 'Return'} {sel.size}</button>
        </div>
      </Collapse>
      </>)}

      {mail && active && <MailModal char={active} recipients={known} iconSet={iconSet} onClose={() => setMail(false)} />}
    </div>
  );
}
