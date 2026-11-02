import { useEffect, useMemo, useState } from 'react';
import { Modal } from './overlay';
import { Stepper, Toggle } from './ui';
import { IconInner } from './atlasIcon';
import { useKnownCharacters, useAvailableIcons, useAhListings } from './bridge';
import { useSettings } from './settings';
import { useAnon } from './anonymize';
import { reachableTotal, isNoTrade, charTotal, stackSize } from './consolidate';
import { buildDistributePlan, runDistribute, stopDistribute, clearDistribute, useDistribute, distEligible, type DistMode, type DistItemCfg, type DistListCfg } from './distribute';
import ConsoProgress from './ConsoProgress';

const MODES: { id: DistMode; label: string }[] = [{ id: 'each', label: 'Each' }, { id: 'split', label: 'Split' }, { id: 'fill', label: 'Fill' }];

export default function DistributeModal({ holder, items, onClose }: { holder: string; items: { id: number; n: string }[]; onClose: () => void }) {
  const known = useKnownCharacters();
  const iconSet = useAvailableIcons();
  const exp = useSettings().experimentalFeatures;
  const anon = useAnon();
  const run = useDistribute();

  const holderChar = known.find((k) => k.name === holder);
  const itemIds = useMemo(() => items.map((it) => it.id), [items]);
  const assetsFor = (name: string) => known.find((k) => k.name === name)?.assets;

  const [cfg, setCfg] = useState<Record<number, DistItemCfg>>(() => Object.fromEntries(items.map((it) => [it.id, { mode: 'each', amount: 1 } as DistItemCfg])));
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const setItemCfg = (id: number, p: Partial<DistItemCfg>) => setCfg((c) => ({ ...c, [id]: { ...(c[id] ?? { mode: 'each', amount: 1 }), ...p } }));

  // Distribute & List: after the hand-offs, each char lists its share on the AH at these per-item prices.
  const [alsoList, setAlsoList] = useState(false);
  const [listCfg, setListCfg] = useState<DistListCfg>(() => Object.fromEntries(items.map((it) => [it.id, { price: 0, single: 0 as 0 | 1 }])));
  const setItemListCfg = (id: number, p: Partial<{ price: number; single: 0 | 1 }>) => setListCfg((c) => ({ ...c, [id]: { ...(c[id] ?? { price: 0, single: 0 }), ...p } }));

  const available = useMemo(() => Object.fromEntries(itemIds.map((id) => [id, isNoTrade(holderChar, id) ? 0 : reachableTotal(holderChar, id, exp)])), [itemIds, holderChar, exp]);

  // Every character but the holder, with eligibility.
  const recipients = useMemo(() => known
    .filter((k) => k.name !== holder)
    .map((k) => ({ name: k.name, online: k.online, elig: distEligible(holderChar, k.name, itemIds, exp) }))
    .sort((a, b) => (a.elig.ok === b.elig.ok ? a.name.localeCompare(b.name) : a.elig.ok ? -1 : 1)),
  [known, holder, holderChar, itemIds, exp]);

  const activeNames = useMemo(() => recipients.filter((r) => r.elig.ok && !excluded.has(r.name)).map((r) => r.name), [recipients, excluded]);
  const { plan } = useMemo(() => buildDistributePlan(holder, itemIds, activeNames, cfg, exp), [holder, itemIds, activeNames, cfg, exp]);
  const totalFor = (id: number) => activeNames.reduce((s, r) => s + (plan[r]?.[id] ?? 0), 0);
  const recipientGets = (name: string) => Object.values(plan[name] ?? {}).reduce((a, b) => a + b, 0);
  const grandTotal = itemIds.reduce((s, id) => s + totalFor(id), 0);
  const busy = run.running;

  // On a very large job the desktop can mark the run finished while the holder's addon
  // is still working through the last trades. tradeStatus.active is the addon's real
  // "trading right now" signal, so keep the progress UI up while EITHER side is busy,
  // with a short grace so the gaps between trade windows don't snap it back to setup.
  const ht = holderChar?.tradeStatus;
  const holderTrading = !!ht?.active;
  const working = busy || holderTrading;
  const [graced, setGraced] = useState(false);
  useEffect(() => {
    if (working) { setGraced(true); return; }
    const t = window.setTimeout(() => setGraced(false), 6000);
    return () => window.clearTimeout(t);
  }, [working]);
  const busyUI = working || graced;

  // Live AH-listing progress for this run: every copy we fire is a pending listing tagged with run.listBatchId,
  // resolved to ok/fail as the addon reports each `ahlisted`. This is what drives the "Listing on AH" readout.
  const allListings = useAhListings();
  const batchListings = useMemo(
    () => (run.listBatchId == null ? [] : allListings.filter((l) => l.batchId === run.listBatchId)),
    [allListings, run.listBatchId],
  );
  const listOk = batchListings.filter((l) => l.status === 'ok').length;
  const listFail = batchListings.filter((l) => l.status === 'fail');
  const listPending = batchListings.filter((l) => l.status === 'pending').length;
  const listTotal = batchListings.length;

  // Each participating character posts ONE auction per item: one single, or one full stack (the Stack/Single
  // toggle). A char lists an item if it will hold any of it after the hand-offs -- a recipient that received a
  // share, and the holder for whatever it keeps. `after` is that character's expected holdings once the run
  // lands (recipient = current + received; holder = current - handed out), which is what the stack gate checks.
  const curTotal = (name: string, id: number) => charTotal(known.find((k) => k.name === name), id) ?? 0;
  const holderAfter = (id: number) => Math.max(0, curTotal(holder, id) - totalFor(id));
  const listersFor = (id: number): { name: string; after: number }[] => {
    const out: { name: string; after: number }[] = [];
    for (const r of activeNames) { const got = plan[r]?.[id] ?? 0; if (got > 0) out.push({ name: r, after: curTotal(r, id) + got }); }
    if (holderAfter(id) > 0) out.push({ name: holder, after: holderAfter(id) });
    return out;
  };
  const nameOf = (id: number) => items.find((it) => it.id === id)?.n ?? `#${id}`;
  const willList = (id: number) => alsoList && listersFor(id).length > 0;
  // Every item that would be listed needs a price before we can start.
  const listReady = !alsoList || itemIds.every((id) => !willList(id) || (listCfg[id]?.price ?? 0) > 0);

  // STACK VALIDATION: a stack listing needs a FULL stack on hand after the distribution. Flag any item set to
  // Stack where a would-be lister won't reach a full stack -- those auctions are skipped, so warn before start.
  const stackWarnings = useMemo(() => itemIds.flatMap((id) => {
    const lc = listCfg[id];
    if (!alsoList || !lc || lc.single !== 0 || (lc.price ?? 0) <= 0) return [];
    const need = stackSize(id);
    if (need <= 1) return []; // item doesn't stack -- nothing to validate
    const listers = listersFor(id);
    const cant = listers.filter((l) => l.after < need).map((l) => l.name);
    return cant.length ? [{ id, need, cant, total: listers.length }] : [];
  }), [itemIds, listCfg, alsoList, activeNames, plan, known, holder]); // eslint-disable-line react-hooks/exhaustive-deps

  // AH gate: listing needs an auction house, so EVERY character that would list (the holder + every active
  // recipient) must be in a zone with AH access (same `atah` flag the AH view uses). No partial listing.
  const atahOf = (name: string) => { const k = known.find((x) => x.name === name); return !!(k?.atah ?? k?.ah?.atah); };
  const noAhChars = alsoList && grandTotal > 0 ? [holder, ...activeNames].filter((n) => !atahOf(n)) : [];
  const ahGateOk = noAhChars.length === 0;

  const start = () => {
    const { plan: p } = buildDistributePlan(holder, itemIds, activeNames, cfg, exp);
    if (!alsoList) { void runDistribute(holder, p, exp); return; }
    void runDistribute(holder, p, exp, { cfg: listCfg });
  };

  return (
    <Modal onClose={() => { clearDistribute(); onClose(); }} panelClass="w-[min(94vw,480px)] max-h-[86vh]">
      {(close) => (
        <div className="flex flex-col min-h-0">
          <div className="shrink-0 px-4 pt-4 pb-3 border-b border-line">
            <h2 className="text-[14px] font-bold text-fg">Distribute</h2>
            <p className="text-[11px] text-fg-4 mt-1 leading-snug">Hand out items from <span className="text-fg-2 font-semibold">{anon(holder)}</span> to your other characters. They must be in the same zone within trading distance.</p>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
            {busyUI && (
              <div className="rounded-md border border-line bg-surface overflow-hidden">
                {busy && <ConsoProgress />}
                <div className="px-3 py-1.5 text-[11px] text-fg-3">
                  {busy
                    ? <>{run.current ? `Trading to ${anon(run.current)}` : 'Preparing…'} <span className="text-fg-4 tabular-nums">({run.done.length}/{run.order.length})</span></>
                    : <>Finishing trades{ht?.target ? ` to ${anon(ht.target)}` : ''}…{ht?.total ? <span className="text-fg-4 tabular-nums"> ({ht.done ?? 0}/{ht.total})</span> : null}</>}
                </div>
                {run.error && <div className="px-3 py-1.5 text-[10px] text-red-300">{run.error}</div>}
              </div>
            )}

            {/* Listing progress: one auction per participating char, resolved live as each `ahlisted` returns. */}
            {alsoList && listTotal > 0 && (
              <div className="rounded-md border border-line bg-surface overflow-hidden">
                <div className="flex flex-col gap-1 px-3 py-2">
                  <div className="flex items-center justify-between gap-2 text-[10px]">
                    <span className="text-fg-2 font-semibold min-w-0 truncate">
                      {listPending > 0 ? 'Listing on AH…' : listFail.length > 0 ? 'Listing done (with errors)' : 'Listing complete'}
                    </span>
                    <span className="text-fg-4 tabular-nums shrink-0">
                      {listOk}/{listTotal}{listFail.length > 0 ? ` · ${listFail.length} failed` : ''}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-line overflow-hidden flex">
                    <div className="h-full bg-accent transition-all duration-300" style={{ width: `${(listOk / listTotal) * 100}%` }} />
                    <div className="h-full bg-red-500 transition-all duration-300" style={{ width: `${(listFail.length / listTotal) * 100}%` }} />
                  </div>
                </div>
                {listFail.length > 0 && (
                  <div className="px-3 pb-1.5 space-y-0.5 border-t border-line pt-1.5">
                    {listFail.slice(0, 6).map((l) => (
                      <div key={l.key} className="text-[10px] text-red-300 flex items-center gap-1.5 min-w-0">
                        <span className="text-fg-3 shrink-0">{anon(l.name)}</span>
                        <span className="truncate">{l.reason ?? 'failed'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Stack-listing validation: warn when a char won't hold a full stack to post. */}
            {!busyUI && stackWarnings.length > 0 && (
              <div className="rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[10px] text-amber-300 space-y-0.5">
                {stackWarnings.map((w) => (
                  <div key={w.id}>
                    <span className="font-semibold">{nameOf(w.id)}</span>: {w.cant.length} of {w.total} won't have a full stack ({w.need}) after distributing and will be skipped ({w.cant.map((n) => anon(n)).join(', ')}).
                  </div>
                ))}
              </div>
            )}

            {/* Distribute & List toggle */}
            <label className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-line bg-surface cursor-pointer select-none">
              <Toggle on={alsoList} onChange={setAlsoList} />
              <span className="text-[12px] font-semibold text-fg">Also list on AH</span>
              <span className="text-[11px] text-fg-4 truncate">each character lists its share after receiving</span>
            </label>

            {/* Items + how much each recipient gets */}
            {items.map((it) => {
              const c = cfg[it.id] ?? { mode: 'each' as DistMode, amount: 1 };
              const lc = listCfg[it.id] ?? { price: 0, single: 0 as 0 | 1 };
              return (
                <div key={it.id} className="rounded-lg border border-line bg-surface overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <div className="shrink-0 w-6 h-6 rounded bg-field grid place-items-center overflow-hidden"><IconInner id={it.id} size={24} name={it.n} assets={assetsFor(holder)} bmpHas={iconSet.has(it.id)} /></div>
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-fg">{it.n}</span>
                    <span className="shrink-0 text-[11px] text-fg-4 tabular-nums">{available[it.id]} held</span>
                  </div>
                  <div className="flex items-center gap-2 px-3 pb-2.5">
                    <div className="flex rounded-md border border-line overflow-hidden">
                      {MODES.map((m) => (
                        <button key={m.id} onClick={() => setItemCfg(it.id, { mode: m.id })} className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${c.mode === m.id ? 'bg-accent text-on-accent' : 'text-fg-3 hover:bg-field'}`}>{m.label}</button>
                      ))}
                    </div>
                    {c.mode !== 'split' && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-fg-4">{c.mode === 'fill' ? 'to' : ''}</span>
                        <Stepper value={c.amount} min={1} max={99} onChange={(v) => setItemCfg(it.id, { amount: v })} />
                        <span className="text-[11px] text-fg-4">{c.mode === 'fill' ? 'each' : 'each'}</span>
                      </div>
                    )}
                    {c.mode === 'split' && <span className="text-[11px] text-fg-4">split evenly across recipients</span>}
                    <span className="ml-auto text-[11px] font-semibold text-accent tabular-nums">{totalFor(it.id)} out</span>
                  </div>
                  {alsoList && willList(it.id) && (
                    <div className="flex items-center gap-2 px-3 pb-2.5 pt-2 border-t border-line">
                      <span className="text-[11px] text-fg-4 shrink-0">AH price</span>
                      <input
                        type="number" min={1} inputMode="numeric"
                        value={lc.price || ''}
                        onChange={(e) => setItemListCfg(it.id, { price: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                        placeholder="gil"
                        className={`w-28 bg-field border rounded px-2 py-1 text-[11px] text-fg tabular-nums outline-none focus:border-accent/60 ${lc.price > 0 ? 'border-line' : 'border-amber-500/50'}`}
                      />
                      <div className="flex rounded-md border border-line overflow-hidden ml-1">
                        {([{ v: 0, l: 'Stack' }, { v: 1, l: 'Single' }] as const).map((o) => (
                          <button key={o.v} onClick={() => setItemListCfg(it.id, { single: o.v })} className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${lc.single === o.v ? 'bg-accent text-on-accent' : 'text-fg-3 hover:bg-field'}`}>{o.l}</button>
                        ))}
                      </div>
                      <span className="ml-auto text-[10px] text-fg-4 shrink-0">{lc.single === 1 ? '1 single / char' : '1 stack / char'}</span>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Recipients */}
            <div className="rounded-lg border border-line bg-surface overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-line">
                <span className="text-[11px] font-bold text-fg">Recipients</span>
                <span className="text-[10px] text-fg-4 tabular-nums">{activeNames.length} selected</span>
                <div className="ml-auto flex gap-1">
                  <button onClick={() => setExcluded(new Set())} className="px-2 py-0.5 rounded text-[10px] border border-line text-fg-3 hover:text-accent hover:border-accent transition-colors">All</button>
                  <button onClick={() => setExcluded(new Set(recipients.map((r) => r.name)))} className="px-2 py-0.5 rounded text-[10px] border border-line text-fg-3 hover:text-fg transition-colors">None</button>
                </div>
              </div>
              <div className="divide-y divide-line">
                {recipients.map((r) => {
                  const active = r.elig.ok && !excluded.has(r.name);
                  const gets = recipientGets(r.name);
                  return (
                    <button
                      key={r.name}
                      disabled={!r.elig.ok}
                      onClick={() => setExcluded((s) => { const n = new Set(s); if (n.has(r.name)) n.delete(r.name); else n.add(r.name); return n; })}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${r.elig.ok ? 'hover:bg-field' : 'opacity-45 cursor-default'}`}
                    >
                      <span className={`w-3.5 h-3.5 rounded border shrink-0 grid place-items-center ${active ? 'bg-accent border-accent' : 'border-line'}`}>{active && <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 text-on-accent" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}</span>
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.online ? 'bg-emerald-400' : 'bg-fg-4'}`} />
                      <span className="min-w-0 flex-1 truncate text-[12px] text-fg-2">{anon(r.name)}</span>
                      {r.elig.ok
                        ? <span className={`shrink-0 text-[11px] tabular-nums font-semibold ${active && gets > 0 ? 'text-accent' : 'text-fg-4'}`}>{active ? (gets > 0 ? `+${gets}` : '0') : 'off'}</span>
                        : <span className="shrink-0 text-[10px] text-fg-4">{r.elig.reason}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="shrink-0 flex items-center gap-2 p-4 pt-3 border-t border-line">
            <div className="text-[11px] text-fg-4 min-w-0">{grandTotal > 0 ? `Sending ${grandTotal} to ${activeNames.length} character${activeNames.length === 1 ? '' : 's'}${alsoList ? ', then listing on AH' : ''}` : 'Nothing to send'}
              {!ahGateOk ? <span className="text-amber-300"> · not at an auction house: {noAhChars.map((n) => anon(n)).join(', ')}</span>
                : alsoList && grandTotal > 0 && !listReady ? <span className="text-amber-300"> · set a price for each item</span> : null}</div>
            <button onClick={() => { clearDistribute(); close(); }} className="le-tap ml-auto px-3 py-1.5 text-[12px] font-semibold rounded-md border border-line bg-field text-fg-2 hover:text-fg transition-colors">{busyUI ? 'Close' : 'Cancel'}</button>
            {busyUI
              ? <button onClick={stopDistribute} className="le-tap px-4 py-1.5 text-[12px] font-bold rounded-md bg-red-500/90 text-white hover:bg-red-500 transition-colors">Stop</button>
              : <button onClick={start} disabled={grandTotal === 0 || !listReady || !ahGateOk} title={!ahGateOk ? 'Every character must be in a zone with an auction house to list' : !listReady ? 'Set an AH price for each item being listed' : undefined} className="le-tap px-4 py-2 text-[12px] font-bold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors">{alsoList ? 'Distribute & List' : 'Distribute'}</button>}
          </div>
        </div>
      )}
    </Modal>
  );
}
