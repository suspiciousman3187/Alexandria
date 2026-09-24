import { useEffect, useMemo, useState } from 'react';
import { Modal } from './overlay';
import { Select, Stepper, GilInput, Slider } from './ui';
import { IconInner } from './atlasIcon';
import { useKnownCharacters, useAvailableIcons } from './bridge';
import { useIncBid, runIncrementalBid, stopIncBid, clearIncBid } from './incbid';
import { useAnon } from './anonymize';

const INCS = [10000, 50000, 100000, 1000000];
const fmtInc = (n: number) => (n >= 1000000 ? `+${n / 1000000}M` : `+${n / 1000}K`);

export default function IncBidModal({ id, n, single, qty, startPrice, rare, assets, defaultChar, onClose }: { id: number; n: string; single: number; qty: number; startPrice: number; rare?: boolean; assets?: string; defaultChar?: string; onClose: () => void }) {
  const anon = useAnon();
  const known = useKnownCharacters();
  const iconSet = useAvailableIcons();
  const run = useIncBid();
  const [, force] = useState(0);
  useEffect(() => {
    if (!run.running || !run.waitUntil) return;
    const t = window.setInterval(() => force((x) => x + 1), 100);
    return () => window.clearInterval(t);
  }, [run.running, run.waitUntil]);
  const atAh = useMemo(() => known.filter((k) => {
    if (!(k.online && k.conn != null && (k.atah ?? k.ah?.atah))) return false;
    if (rare) { let c = 0; for (const b of k.inv ?? []) for (const it of b.items) if (it.id === id) c += it.c; if (c >= 1) return false; }
    return true;
  }), [known, rare, id]);

  const [start, setStart] = useState(String(startPrice || ''));
  const [inc, setInc] = useState(50000);
  const [tries, setTries] = useState(5);
  const [delaySec, setDelaySec] = useState(20);
  const [char, setChar] = useState(() => (defaultChar && atAh.some((k) => k.name === defaultChar) ? defaultChar : atAh[0]?.name ?? ''));

  const startNum = Number(start) || 0;
  const charObj = atAh.find((k) => k.name === char) ?? atAh[0];
  const maxBid = startNum + inc * Math.max(0, tries - 1);
  const canStart = !!charObj?.conn && startNum > 0 && tries >= 1 && !run.running;

  const begin = () => {
    if (!canStart || charObj?.conn == null) return;
    void runIncrementalBid({ conn: charObj.conn, charName: charObj.name, id, itemName: n, single, qty, startPrice: startNum, increment: inc, maxTries: tries, delayMs: delaySec * 1000 });
  };

  return (
    <Modal onClose={() => { clearIncBid(); onClose(); }} panelClass="w-[min(94vw,420px)] p-4 gap-3">
      {(close) => (
        <>
          <div className="flex items-center gap-2">
            <div className="relative shrink-0 w-7 h-7 rounded bg-field grid place-items-center overflow-hidden"><IconInner id={id} size={28} name={n} assets={assets} bmpHas={id > 0 && iconSet.has(id)} /></div>
            <div className="text-[14px] font-bold text-fg truncate flex-1 min-w-0">Incremental Bid: {n}</div>
          </div>

          {atAh.length === 0 ? (
            <div className="rounded-md bg-amber-500/10 border border-amber-500/25 px-3 py-2 text-[11px] text-amber-300 text-center">{rare ? 'No eligible character. This is a Rare item, so any character that already owns one is excluded.' : 'No character is in a zone with an auction house.'}</div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-3 shrink-0 w-16">Bid As</span>
                <div className="flex-1 min-w-0">
                  <Select
                    value={char}
                    onChange={setChar}
                    options={atAh.map((c) => c.name)}
                    renderOption={(v) => { const c = atAh.find((x) => x.name === v); const g = c?.gil ?? 0; return <span className="flex items-center gap-2 min-w-0"><span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c?.online ? 'bg-emerald-400' : 'bg-fg-4'}`} /><span className="truncate">{anon(v)}</span><span className={`ml-auto tabular-nums text-[11px] shrink-0 ${g < startNum ? 'text-red-400/80' : 'text-amber-300'}`}>{g.toLocaleString()} G</span></span>; }}
                    renderValue={(v) => { const c = atAh.find((x) => x.name === v); const g = c?.gil ?? 0; return <span className="flex items-center gap-2 min-w-0"><span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c?.online ? 'bg-emerald-400' : 'bg-fg-4'}`} /><span className="truncate">{anon(v)}</span><span className={`ml-auto tabular-nums text-[11px] shrink-0 ${g < startNum ? 'text-red-400/80' : 'text-amber-300'}`}>{g.toLocaleString()} G</span></span>; }}
                    full
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-3 shrink-0 w-16">Start</span>
                <GilInput value={start} onChange={setStart} placeholder="Starting bid (gil)" className="flex-1 min-w-0 bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 tabular-nums" />
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-3">Increase Per Failed Bid</span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <GilInput value={String(inc)} onChange={(v) => setInc(Number(v) || 0)} placeholder="Custom" className="w-24 bg-field border border-line rounded-md px-2.5 py-1 text-[11px] text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 tabular-nums" />
                  {INCS.map((v) => (
                    <button key={v} onClick={() => setInc(v)} className={`le-tap px-2.5 py-1 text-[11px] font-bold rounded-md border transition-colors ${inc === v ? 'bg-accent text-on-accent border-transparent' : 'border-line bg-field text-fg-3 hover:text-fg'}`}>{fmtInc(v)}</button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-3 shrink-0 w-16">Max Tries</span>
                <Stepper value={tries} min={1} max={50} onChange={setTries} className="shrink-0" />
                <span className="text-[10px] text-fg-4 ml-auto text-right">Up to <span className="text-amber-300 font-bold tabular-nums">{maxBid.toLocaleString()} G</span> on the final try</span>
              </div>

              {tries > 10 && <div className="rounded-md bg-red-500/10 border border-red-500/30 px-3 py-2 text-[11px] font-semibold text-red-300 text-center">Please be careful when bidding repeatedly over a long time!</div>}

              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-3 shrink-0 w-16">Delay</span>
                <div className="flex-1 min-w-0"><Slider value={delaySec} min={1} max={60} step={1} suffix="s" onChange={setDelaySec} /></div>
              </div>

              {(run.running || run.status !== 'idle') && (
                <div className={`rounded-md border px-3 py-2 text-[11px] flex flex-col gap-1 ${run.status === 'won' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : run.status === 'bidding' ? 'border-line bg-surface text-fg-2' : 'border-amber-500/25 bg-amber-500/10 text-amber-300'}`}>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{run.status === 'won' ? 'Won' : run.status === 'bidding' ? `Attempt ${run.attempt}/${run.maxTries}` : run.status === 'gaveup' ? 'Gave Up' : run.status === 'broke' ? 'Out Of Gil' : 'Stopped'}</span>
                    {run.status === 'bidding' && <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />}
                    <span className="ml-auto tabular-nums">{run.price.toLocaleString()} gil</span>
                  </div>
                  {run.note && <div className="text-[10px] opacity-90 leading-snug">{run.note}</div>}
                  {run.running && run.waitUntil != null && run.waitMs != null && (() => {
                    const remaining = Math.max(0, run.waitUntil - Date.now());
                    const pct = Math.min(100, Math.max(0, Math.round((1 - remaining / run.waitMs) * 100)));
                    return (
                      <div className="flex flex-col gap-1 pt-0.5">
                        <div className="flex items-center justify-between text-[10px] text-fg-4"><span>Next attempt in</span><span className="tabular-nums text-fg-2 font-semibold">{(remaining / 1000).toFixed(1)}s</span></div>
                        <div className="h-1 rounded-full bg-line overflow-hidden"><div className="h-full rounded-full bg-amber-400" style={{ width: `${pct}%` }} /></div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </>
          )}

          <div className="flex items-center gap-2 pt-0.5">
            <button onClick={() => { clearIncBid(); close(); }} className="le-tap px-3 py-1.5 text-[12px] font-semibold rounded-md border border-line bg-field text-fg-2 hover:text-fg transition-colors">{run.running ? 'Close' : 'Cancel'}</button>
            {run.running
              ? <button onClick={stopIncBid} className="le-tap ml-auto px-4 py-1.5 text-[12px] font-bold rounded-md bg-red-500/90 text-white hover:bg-red-500 transition-colors">Stop</button>
              : <button onClick={begin} disabled={!canStart} className="le-tap ml-auto px-4 py-1.5 text-[12px] font-bold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors">Start Bidding</button>}
          </div>
        </>
      )}
    </Modal>
  );
}
