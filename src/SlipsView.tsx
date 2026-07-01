import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useKnownCharacters, useAvailableIcons, slipStore, slipRetrieve, moveItem, inTauri, type Slip, type PorterProgress } from './bridge';
import { useItemHover } from './ItemTooltip';
import { CharacterSelect } from './ui';
import { useStickyChar } from './sticky';
import { OpCard } from './OpCard';

function PorterStatus({ porter }: { porter: PorterProgress }) {
  const total = porter.total ?? 0;
  const done = porter.done ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const verb = porter.op === 'retrieve' ? 'Retriev' : 'Stor';
  return (
    <OpCard
      className="mb-3"
      state={porter.active ? 'active' : 'ok'}
      title={porter.active ? `${verb}ing items at the Porter Moogle…` : `${verb}ed ${done} of ${total}`}
      count={`${done} / ${total}`}
      pct={pct}
    />
  );
}

function Icon({ id, n, assets, count, onClick, title, selected }: { id: number; n: string; assets?: string; count?: number; onClick?: () => void; title?: string; selected?: boolean }) {
  const hover = useItemHover({ id, n, c: count });
  const [broken, setBroken] = useState(false);
  const ready = useAvailableIcons().has(id);
  const src = ready && assets && inTauri ? convertFileSrc(`${assets}/icon_${id}.bmp`) : null;
  const inner = (
    <>
      {src && !broken ? <img src={src} alt="" onError={() => setBroken(true)} className="w-8 h-8 object-contain" /> : <span className="text-[9px] text-fg-4 px-0.5 text-center leading-tight">{n.slice(0, 4)}</span>}
      {count != null && count > 1 && <span className="absolute bottom-0 right-0.5 text-[9px] font-bold text-fg-2 tabular-nums drop-shadow">{count}</span>}
      {selected && (
        <span className="absolute inset-0 bg-accent/20 grid place-items-center">
          <span className="w-4 h-4 rounded-full bg-accent grid place-items-center shadow">
            <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 text-on-accent" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 6" /></svg>
          </span>
        </span>
      )}
    </>
  );
  if (onClick) {
    return (
      <button {...hover} title={title ?? n} onClick={onClick} className={`relative w-9 h-9 rounded grid place-items-center overflow-hidden border transition-colors ${selected ? 'border-accent ring-1 ring-accent bg-field' : 'border-line bg-field hover:border-accent'}`}>
        {inner}
      </button>
    );
  }
  return <div {...hover} title={n} className="relative w-9 h-9 rounded bg-field grid place-items-center overflow-hidden">{inner}</div>;
}

function SlipCard({ slip, assets, near, onStoreIds, onRetrieveIds, onGetSlip }: { slip: Slip; assets?: string; near: boolean; onStoreIds: (ids: number[]) => void; onRetrieveIds: (ids: number[]) => void; onGetSlip: () => void }) {
  const hasWork = slip.storable.length > 0 || slip.stored.length > 0;
  const showBanner = hasWork && !slip.ready;
  const usable = slip.ready || slip.getable;
  const canAct = near && usable;
  const tip = !near ? 'Stand next to the Porter Moogle' : !usable ? 'You need this slip in your bags first' : undefined;

  const [selStore, setSelStore] = useState<Set<number>>(() => new Set());
  const [selRet, setSelRet] = useState<Set<number>>(() => new Set());
  const toggle = (setSet: (fn: (p: Set<number>) => Set<number>) => void) => (id: number) => setSet((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const pickStore = slip.storable.filter((it) => selStore.has(it.id));
  const pickRet = slip.stored.filter((it) => selRet.has(it.id));
  const storeIds = (pickStore.length ? pickStore : slip.storable).map((it) => it.id);
  const retIds = (pickRet.length ? pickRet : slip.stored).map((it) => it.id);
  const doStore = () => { if (storeIds.length) { onStoreIds(storeIds); setSelStore(new Set()); } };
  const doRet = () => { if (retIds.length) { onRetrieveIds(retIds); setSelRet(new Set()); } };

  return (
    <section className="mb-4">
      <h2 className="flex items-center gap-2 px-1 mb-2">
        <span className="w-[3px] h-3.5 rounded-sm bg-accent" />
        <span className="text-[11px] font-bold tracking-[0.12em] text-fg">{slip.name}</span>
        <span className="text-[10px] text-fg-4">{slip.stored.length} stored</span>
        <div className="ml-auto flex items-center gap-1.5">
          {slip.stored.length > 0 && (
            <button onClick={doRet} disabled={!canAct} title={tip} className="px-2.5 py-1 text-[11px] font-semibold rounded-md border border-line bg-field text-fg-2 enabled:hover:text-fg disabled:opacity-40 transition-colors">
              Retrieve {pickRet.length || slip.stored.length}
            </button>
          )}
          {slip.storable.length > 0 && (
            <button onClick={doStore} disabled={!canAct} title={tip} className="px-2.5 py-1 text-[11px] font-semibold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors">
              Store {pickStore.length || slip.storable.length}
            </button>
          )}
        </div>
      </h2>
      {showBanner && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2">
          <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0 text-amber-300" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
          <span className="text-[11px] text-amber-100 flex-1 min-w-0">
            {slip.getable
              ? `The slip is in your ${slip.locname}. Bring it to your inventory to use it.`
              : slip.loc >= 0
                ? `The slip is in your ${slip.locname}, which you can't reach here. Open your Mog House to get it.`
                : `You don't have this slip in your bags.`}
          </span>
          {slip.getable && (
            <button onClick={onGetSlip} className="shrink-0 px-2.5 py-1 text-[11px] font-bold rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors">Get Slip</button>
          )}
        </div>
      )}
      <div className="rounded-xl bg-surface border border-line p-3">
        {slip.storable.length > 0 && (
          <>
            <div className="flex items-center mb-1.5">
              <span className="text-[10px] font-semibold text-fg-3">Storable now{canAct ? (pickStore.length ? ` — ${pickStore.length} picked` : ' — tap to pick, or Store all') : ''}</span>
              {canAct && slip.storable.length > 1 && (
                <div className="ml-auto flex items-center gap-2 text-[10px] font-semibold">
                  <button onClick={() => setSelStore(new Set(slip.storable.map((it) => it.id)))} className="text-fg-4 hover:text-accent transition-colors">All</button>
                  {pickStore.length > 0 && <button onClick={() => setSelStore(new Set())} className="text-fg-4 hover:text-accent transition-colors">Clear</button>}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {slip.storable.map((it) => <Icon key={`s${it.id}`} id={it.id} n={it.n} assets={assets} count={it.c} selected={selStore.has(it.id)} onClick={canAct ? () => toggle(setSelStore)(it.id) : undefined} title={it.n} />)}
            </div>
          </>
        )}
        <div className="flex items-center mb-1.5">
          <span className="text-[10px] font-semibold text-fg-4">Stored ({slip.stored.length}){slip.stored.length > 0 && canAct ? (pickRet.length ? ` — ${pickRet.length} picked` : ' — tap to pick, or Retrieve all') : ''}</span>
          {canAct && slip.stored.length > 1 && (
            <div className="ml-auto flex items-center gap-2 text-[10px] font-semibold">
              <button onClick={() => setSelRet(new Set(slip.stored.map((it) => it.id)))} className="text-fg-4 hover:text-accent transition-colors">All</button>
              {pickRet.length > 0 && <button onClick={() => setSelRet(new Set())} className="text-fg-4 hover:text-accent transition-colors">Clear</button>}
            </div>
          )}
        </div>
        {slip.stored.length === 0 ? (
          <div className="text-[11px] text-fg-4">Nothing stored on this slip.</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {slip.stored.map((it) => <Icon key={`d${it.id}`} id={it.id} n={it.n} assets={assets} selected={selRet.has(it.id)} onClick={canAct ? () => toggle(setSelRet)(it.id) : undefined} title={it.n} />)}
          </div>
        )}
      </div>
    </section>
  );
}

export default function SlipsView() {
  const known = useKnownCharacters();
  const online = known.filter((k) => k.online && k.conn != null);
  const [name, setName] = useStickyChar();
  const active = online.find((k) => k.name === name) ?? online[0];
  useEffect(() => { if (active && active.name !== name) setName(active.name); }, [active, name]);

  if (online.length === 0) {
    return (
      <div className="h-full grid place-items-center">
        <div className="text-center max-w-sm">
          <div className="text-[15px] font-bold text-fg mb-1">No Connected Characters</div>
          <div className="text-[12px] text-fg-4 leading-relaxed">Slip contents are read live from the game. Load the Alexandria addon in-game to manage Porter Moogle storage here.</div>
        </div>
      </div>
    );
  }

  const slips = active?.slips ?? [];
  const conn = active?.conn;
  const near = !!active?.porterNear;

  const porter = active?.porter;
  const porterActive = !!porter?.active;
  const [showPorter, setShowPorter] = useState(false);
  useEffect(() => { setShowPorter(false); }, [active?.name]);
  useEffect(() => {
    if (porterActive) { setShowPorter(true); return; }
    if (showPorter) { const t = setTimeout(() => setShowPorter(false), 4000); return () => clearTimeout(t); }
  }, [porterActive, showPorter]);

  return (
    <div className="h-full flex flex-col">
      {online.length > 1 && (
        <div className="shrink-0 px-4 pt-4 pb-3 border-b border-line">
          <CharacterSelect value={active?.name ?? ''} onChange={setName} chars={online} />
        </div>
      )}
      <AnimatePresence initial={false}>
        {showPorter && porter && (
          <motion.div
            key="porter"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="shrink-0 overflow-hidden"
          >
            <div className="px-4 pt-3">
              <PorterStatus porter={porter} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <div className="flex items-center gap-1.5 mb-3 text-[11px]">
          <span className={`w-1.5 h-1.5 rounded-full ${near ? 'bg-emerald-400' : 'bg-fg-4'}`} />
          <span className={near ? 'text-emerald-300' : 'text-fg-4'}>{near ? 'Porter Moogle in range' : 'Porter Moogle not in range — walk up to store or retrieve'}</span>
        </div>
        {slips.length === 0 ? (
          <div className="text-[12px] text-fg-4 text-center py-8">No slips to show. Hold a storage slip or items that can be stored on one.</div>
        ) : (
          slips.map((s) => (
            <SlipCard
              key={s.sid}
              slip={s}
              assets={active?.assets}
              near={near}
              onStoreIds={(ids) => conn != null && ids.length > 0 && slipStore(conn, ids)}
              onRetrieveIds={(ids) => conn != null && ids.length > 0 && slipRetrieve(conn, ids)}
              onGetSlip={() => conn != null && s.loc >= 0 && moveItem(conn, s.sid, s.loc, 0, 1)}
            />
          ))
        )}
      </div>
    </div>
  );
}
