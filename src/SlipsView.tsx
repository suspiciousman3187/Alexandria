import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useKnownCharacters, useAvailableIcons, slipStore, slipRetrieve, moveItem, inTauri, type Slip, type PorterProgress } from './bridge';
import { useItemHover } from './ItemTooltip';
import { itemNameMatches } from './itemNames';
import { useJobFilter, JobFilterSelect } from './jobFilter';
import { slipLabel } from './slipLabels';
import { CharacterSelect, SearchInput, Button } from './ui';
import { Collapse } from './overlay';
import { useStickyChar } from './sticky';
import { OpCard } from './OpCard';
import { usePorterGear } from './porterGear';
import { jobColor, jobFullName } from './jobMeta';

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

function Icon({ id, n, assets, count, onClick, title, selected, match }: { id: number; n: string; assets?: string; count?: number; onClick?: () => void; title?: string; selected?: boolean; match?: boolean }) {
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
      <button {...hover} title={title ?? n} onClick={onClick} className={`relative w-9 h-9 rounded grid place-items-center overflow-hidden border transition-colors ${selected ? 'border-accent ring-1 ring-accent bg-field' : match ? 'border-amber-400 ring-1 ring-amber-400/70 bg-field' : 'border-line bg-field hover:border-accent'}`}>
        {inner}
      </button>
    );
  }
  return <div {...hover} title={n} className={`relative w-9 h-9 rounded bg-field grid place-items-center overflow-hidden ${match ? 'ring-1 ring-amber-400/70 border border-amber-400' : ''}`}>{inner}</div>;
}

function SlipCard({ slip, assets, near, q, jobMatch, onStoreIds, onRetrieveIds, onGetSlip }: { slip: Slip; assets?: string; near: boolean; q: string; jobMatch?: ((id: number) => boolean) | null; onStoreIds: (ids: number[]) => void; onRetrieveIds: (ids: number[]) => void; onGetSlip: () => void }) {
  const hit = (id: number, n: string) => (q !== '' && itemNameMatches(id, n, q)) || !!(jobMatch && jobMatch(id));
  // "All" picks the job-matching items when a job filter is on, else everything.
  const allIds = (list: { id: number; n: string }[]) => new Set((jobMatch ? list.filter((it) => jobMatch(it.id)) : list).map((it) => it.id));
  const hasWork = slip.storable.length > 0 || slip.stored.length > 0;
  const owned = slip.owned !== false; // false = we hold items for this slip but don't have the slip
  const showBanner = hasWork && !slip.ready;
  const canAct = near && slip.ready; // storing/retrieving needs the slip physically in inventory
  const tip = !near ? 'Stand next to the Porter Moogle' : !slip.ready ? (slip.getable ? 'Get this slip into your inventory first' : 'You need this slip in your bags first') : undefined;

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
        <span className="w-[3px] h-8 rounded-sm bg-accent shrink-0" />
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-bold tracking-[0.1em] text-fg-4">{slip.name}</span>
            <span className="text-[10px] text-fg-4">{owned ? `${slip.stored.length} stored` : `${slip.storable.length} to store`}</span>
          </div>
          {slipLabel(slip) !== slip.name && <div className="text-[12.5px] font-bold text-accent truncate leading-tight">{slipLabel(slip)}</div>}
        </div>
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
      <Collapse open={showBanner}>
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2">
          <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0 text-amber-300" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
          <span className="text-[11px] text-amber-100 flex-1 min-w-0">
            {slip.getable
              ? `The slip is in your ${slip.locname}. Bring it to your inventory to use it.`
              : slip.loc >= 0
                ? `The slip is in your ${slip.locname}, which you can't reach here. Open your Mog House to get it.`
                : `You're holding ${slip.storable.length} item${slip.storable.length === 1 ? '' : 's'} for this slip but don't own it. Get the slip into your bags to store them.`}
          </span>
          {slip.getable && (
            <button onClick={onGetSlip} className="le-tap shrink-0 px-2.5 py-1 text-[11px] font-bold rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors">Get Slip</button>
          )}
        </div>
      </Collapse>
      <div className={`rounded-xl bg-surface border p-3 ${owned ? 'border-line' : 'border-line/60'}`}>
        {slip.storable.length > 0 && (
          <>
            <div className="flex items-center mb-1.5">
              <span className="text-[10px] font-semibold text-fg-3">{owned ? 'Storable now' : 'Items for this slip'}{canAct ? (pickStore.length ? ` · ${pickStore.length} picked` : ' · tap to pick, or Store all') : ''}</span>
              {canAct && slip.storable.length > 1 && (
                <div className="ml-auto flex items-center gap-2 text-[10px] font-semibold">
                  <Button variant="ghost" size="xs" onClick={() => setSelStore(allIds(slip.storable))}>{jobMatch ? 'Job' : 'All'}</Button>
                  {pickStore.length > 0 && <Button variant="ghost" size="xs" onClick={() => setSelStore(new Set())}>Clear</Button>}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {slip.storable.map((it) => <Icon key={`s${it.id}`} id={it.id} n={it.n} assets={assets} count={it.c} selected={selStore.has(it.id)} match={hit(it.id, it.n)} onClick={canAct ? () => toggle(setSelStore)(it.id) : undefined} title={it.n} />)}
            </div>
          </>
        )}
        {owned && (
          <>
            <div className="flex items-center mb-1.5">
              <span className="text-[10px] font-semibold text-fg-4">Stored ({slip.stored.length}){slip.stored.length > 0 && canAct ? (pickRet.length ? ` · ${pickRet.length} picked` : ' · tap to pick, or Retrieve all') : ''}</span>
              {canAct && slip.stored.length > 1 && (
                <div className="ml-auto flex items-center gap-2 text-[10px] font-semibold">
                  <Button variant="ghost" size="xs" onClick={() => setSelRet(allIds(slip.stored))}>{jobMatch ? 'Job' : 'All'}</Button>
                  {pickRet.length > 0 && <Button variant="ghost" size="xs" onClick={() => setSelRet(new Set())}>Clear</Button>}
                </div>
              )}
            </div>
            {slip.stored.length === 0 ? (
              <div className="text-[11px] text-fg-4">Nothing stored on this slip.</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {slip.stored.map((it) => <Icon key={`d${it.id}`} id={it.id} n={it.n} assets={assets} selected={selRet.has(it.id)} match={hit(it.id, it.n)} onClick={canAct ? () => toggle(setSelRet)(it.id) : undefined} title={it.n} />)}
              </div>
            )}
          </>
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

  const [filter, setFilter] = useState('');
  const jf = useJobFilter('slips.jobfilter');
  const jm = jf.matches;
  const q = filter.trim().toLowerCase();
  const visible = slips.filter((s) => {
    if (q && !(s.name.toLowerCase().includes(q) || s.storable.some((it) => itemNameMatches(it.id, it.n, q)) || s.stored.some((it) => itemNameMatches(it.id, it.n, q)))) return false;
    if (jm && !(s.storable.some((it) => jm(it.id)) || s.stored.some((it) => jm(it.id)))) return false; // only slips holding gear for this job
    return true;
  });

  const porter = active?.porter;
  const porterActive = !!porter?.active;
  const [showPorter, setShowPorter] = useState(false);
  useEffect(() => { setShowPorter(false); }, [active?.name]);
  useEffect(() => {
    if (porterActive) { setShowPorter(true); return; }
    if (showPorter) { const t = setTimeout(() => setShowPorter(false), 4000); return () => clearTimeout(t); }
  }, [porterActive, showPorter]);

  // Store / Retrieve all gear for the character's CURRENT job, across every reachable slip (shared with Library).
  const gear = usePorterGear(active);
  const { job, storeIds, retrieveIds, blockedCount, running, openStore, openRetrieve } = gear;

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 flex items-center gap-3 px-4 pt-4 pb-3 border-b border-line">
        {online.length > 1
          ? <div className="flex-1 min-w-0"><CharacterSelect value={active?.name ?? ''} onChange={setName} chars={online} /></div>
          : <div className="flex-1 min-w-0 text-[14px] font-bold text-fg truncate">{active?.name}</div>}
        <span className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${near ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-line bg-field text-fg-4'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${near ? 'bg-emerald-400' : 'bg-fg-4'}`} />
          {near ? 'Porter in range' : 'Porter not in range'}
        </span>
      </div>
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
        {job && (storeIds.length > 0 || retrieveIds.length > 0 || blockedCount > 0) && (
          <div className="mb-3 rounded-xl border border-accent/30 bg-accent/[0.06] p-3">
            <div className="mb-2.5">
              <div className="text-[12.5px] font-bold text-fg">Porter Gear Management: <span style={{ color: jobColor(job) }}>{job}</span></div>
              <div className="text-[10.5px] text-fg-4">store/retrieve job-specific gear for <span className="font-semibold" style={{ color: jobColor(job) }}>{jobFullName(job)}</span></div>
            </div>
            <div className="flex gap-2">
              <Button variant="primary" className="flex-1" onClick={openStore} disabled={!near || running || storeIds.length === 0} title={!near ? 'Stand next to the Porter Moogle' : undefined}>Store{storeIds.length ? ` ${storeIds.length}` : ''}</Button>
              <Button variant="secondary" className="flex-1" onClick={openRetrieve} disabled={!near || running || retrieveIds.length === 0} title={!near ? 'Stand next to the Porter Moogle' : undefined}>Retrieve{retrieveIds.length ? ` ${retrieveIds.length}` : ''}</Button>
            </div>
            {!near ? <div className="text-[10.5px] text-amber-300 mt-2">Stand next to the Porter Moogle to store or retrieve.</div>
              : blockedCount > 0 ? <div className="text-[10.5px] text-amber-300/90 mt-2">{blockedCount} more in Mog House storage. Open your Mog House to include them.</div> : null}
          </div>
        )}
        {slips.length > 0 && (
          <div className="flex items-center gap-2 mb-3">
            <SearchInput
              value={filter}
              onChange={setFilter}
              wrap="flex-1"
              placeholder="Search slips or items…"
              className="w-full bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 transition-colors"
            />
            <div className="shrink-0 w-24" title="Filter to a job's gear"><JobFilterSelect value={jf.value} onChange={jf.setValue} /></div>
          </div>
        )}
        {slips.length === 0 ? (
          <div className="text-[12px] text-fg-4 text-center py-8">No slips to show. Hold a storage slip or items that can be stored on one.</div>
        ) : visible.length === 0 ? (
          <div className="text-[12px] text-fg-4 text-center py-8">No slips match “{filter.trim()}”.</div>
        ) : (
          [...visible].sort((a, b) => Number(a.owned === false) - Number(b.owned === false)).map((s) => (
            <SlipCard
              key={s.sid}
              slip={s}
              assets={active?.assets}
              near={near}
              q={q}
              jobMatch={jm}
              onStoreIds={(ids) => conn != null && ids.length > 0 && slipStore(conn, ids)}
              onRetrieveIds={(ids) => conn != null && ids.length > 0 && slipRetrieve(conn, ids)}
              onGetSlip={() => conn != null && s.loc >= 0 && moveItem(conn, s.sid, s.loc, 0, 1)}
            />
          ))
        )}
      </div>
      {gear.modals}
    </div>
  );
}
