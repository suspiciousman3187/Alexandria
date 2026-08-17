import { useEffect, useMemo, useState } from 'react';
import { Modal } from './overlay';
import { CharacterSelect } from './ui';
import { IconInner } from './atlasIcon';
import { useKnownCharacters, useAvailableIcons } from './bridge';
import { useConsolidate, runConsolidateSelection, stopConsolidate, clearConsolidate, recipientSpace, incomingHolders, stuckIncoming, buildCappedBySender } from './consolidate';
import { addConsoJob } from './consoQueue';
import ConsoProgress from './ConsoProgress';
import { useSettings } from './settings';
import { useAnon } from './anonymize';

const STATUS_DOT: Record<string, string> = { pending: 'bg-fg-4', moving: 'bg-sky-400', trading: 'bg-amber-400', ok: 'bg-emerald-400', fail: 'bg-red-400' };
const STATUS_LABEL: Record<string, string> = { pending: 'Waiting', moving: 'Gathering', trading: 'Trading', ok: 'Done', fail: 'Failed' };

export default function ConsolidateToModal({ id, n, assets, defaultRecipient, onClose }: { id: number; n: string; assets?: string; defaultRecipient?: string; onClose: () => void }) {
  const known = useKnownCharacters();
  const iconSet = useAvailableIcons();
  const exp = useSettings().experimentalFeatures;
  const anon = useAnon();
  const run = useConsolidate();
  const online = useMemo(() => known.filter((k) => k.online && k.conn != null), [known]);
  useEffect(() => { clearConsolidate(); }, []);

  const [recipient, setRecipient] = useState(() => (defaultRecipient && online.some((o) => o.name === defaultRecipient) ? defaultRecipient : online[0]?.name ?? ''));
  const rChar = online.find((o) => o.name === recipient);
  const mog = !!rChar?.mog;

  const space = useMemo(() => (recipient ? recipientSpace(recipient, id, exp) : null), [recipient, id, exp, known]);
  const holders = useMemo(() => (recipient ? incomingHolders(recipient, id, exp) : 0), [recipient, id, exp, known]);
  const stuck = useMemo(() => (recipient ? stuckIncoming(recipient, id, exp) : 0), [recipient, id, exp, known]);
  const incoming = space?.incoming ?? 0;

  const [amount, setAmount] = useState(incoming);
  useEffect(() => { setAmount(space && !space.fits ? space.maxFit : incoming); }, [recipient, id, incoming, space?.fits, space?.maxFit]);
  const amt = Math.max(0, Math.min(amount, incoming));

  const breakdown = useMemo(() => {
    if (!recipient || incoming <= 0) return [] as { name: string; count: number }[];
    const by = buildCappedBySender(recipient, id, amt, exp);
    return Object.entries(by).map(([name, m]) => ({ name, count: m[id] ?? 0 })).filter((x) => x.count > 0).sort((a, b) => b.count - a.count);
  }, [recipient, id, amt, exp, known, incoming]);

  const busy = run.running;
  const canRun = !!recipient && !mog && incoming > 0 && amt > 0 && !busy;

  const start = () => {
    if (!canRun) return;
    void runConsolidateSelection(recipient, buildCappedBySender(recipient, id, amt, exp), exp);
  };

  return (
    <Modal onClose={onClose} panelClass="w-[min(94vw,400px)] max-h-[88vh]">
      {(close) => (
        <>
          <div className="shrink-0 flex items-center gap-2 p-4 pb-3">
            <div className="relative shrink-0 w-7 h-7 rounded bg-field grid place-items-center overflow-hidden">
              <IconInner id={id} size={28} name={n} assets={assets} bmpHas={id > 0 && iconSet.has(id)} />
            </div>
            <div className="text-[14px] font-bold text-fg truncate flex-1 min-w-0">Consolidate {n}</div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-1 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-3 shrink-0">To</span>
            <div className="flex-1 min-w-0"><CharacterSelect value={recipient} onChange={setRecipient} chars={online} /></div>
          </div>

          {mog ? (
            <div className="rounded-md bg-red-500/10 border border-red-500/25 px-3 py-2 text-[11px] text-red-300">{anon(recipient)} is in a Mog House; player trades can't reach a private residence.</div>
          ) : incoming === 0 ? (
            <div className="rounded-md bg-field border border-line px-3 py-2 text-[11px] text-fg-4">No other character in {anon(recipient)}'s zone has a tradeable {n}. Characters must be in the same zone to trade.</div>
          ) : (
            <>
              <div className="rounded-md bg-field border border-line px-3 py-2 flex flex-col gap-1.5 text-[11px]">
                <div className="flex items-center justify-between"><span className="text-fg-4">Gathering From</span><span className="text-fg-2 font-semibold tabular-nums">{holders} character{holders === 1 ? '' : 's'}</span></div>
                <div className="flex items-center justify-between"><span className="text-fg-4">{anon(recipient)}'s Free Slots In Inventory</span><span className={`font-semibold tabular-nums ${space && space.slotsFree <= 0 ? 'text-red-300' : 'text-fg-2'}`}>{space?.slotsFree ?? 0}</span></div>
                <div className="flex items-center justify-between"><span className="text-fg-4">Available</span><span className="text-fg-2 font-semibold tabular-nums">{incoming}</span></div>
                {stuck > 0 && (
                  <div className="flex items-center justify-between border-t border-line pt-1.5 text-fg-4">
                    <span className="inline-flex items-center gap-1"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>Inaccessible</span>
                    <span className="font-semibold tabular-nums">{stuck}</span>
                  </div>
                )}
              </div>

              {stuck > 0 && <div className="rounded-md bg-amber-500/10 border border-amber-500/25 px-3 py-2 text-[11px] text-amber-300 text-center">{stuck} more can't be consolidated (stuck in inaccessible bags).</div>}

              {space && !space.fits && (
                <div className="rounded-md bg-amber-500/10 border border-amber-500/25 px-3 py-2 text-[11px] text-amber-300">
                  {anon(recipient)} only has room for <span className="font-bold tabular-nums">{space.maxFit}</span> of {incoming}. Reduce the amount below or free up inventory space.
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-fg-3 font-semibold">Consolidate</span>
                  <span className="tabular-nums text-fg-2 font-semibold">{amt}{amt < incoming ? <span className="text-fg-4 font-normal"> / {incoming}</span> : null}</span>
                </div>
                <input type="range" min={0} max={incoming} value={amt} onChange={(e) => setAmount(Number(e.target.value))} disabled={busy} className="w-full accent-[var(--color-accent)]" />
                {amt < incoming && <div className="text-[10px] text-fg-4">{incoming - amt} left on the other characters.</div>}
              </div>

              {breakdown.length > 0 && (
                <div className="rounded-md border border-line bg-surface divide-y divide-line overflow-hidden">
                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-fg-4">From Each Character</div>
                  {breakdown.map((s) => (
                    <div key={s.name} className="px-3 py-1.5 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                      <span className="text-[11px] text-fg-2 font-semibold min-w-0 truncate">{anon(s.name)}</span>
                      <span className="ml-auto text-[11px] tabular-nums font-semibold text-fg">×{s.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {(run.running || run.order.length > 0) && (
            <div className="rounded-md border border-line bg-surface divide-y divide-line overflow-hidden">
              <ConsoProgress />
              {run.order.map((name) => {
                const cs = run.chars[name];
                if (!cs) return null;
                return (
                  <div key={name} className="px-3 py-1.5 flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[cs.status]}`} />
                    <span className="text-[11px] text-fg-2 font-semibold min-w-0 truncate">{anon(name)}</span>
                    <span className="text-[10px] text-fg-4 shrink-0">{STATUS_LABEL[cs.status]}</span>
                    <span className="ml-auto text-[10px] tabular-nums text-fg-3 shrink-0">{cs.sent}/{cs.goal}</span>
                  </div>
                );
              })}
              {run.error && <div className="px-3 py-1.5 text-[10px] text-red-300">{run.error}</div>}
            </div>
          )}

          </div>

          <div className="shrink-0 flex items-center gap-2 p-4 pt-3 border-t border-line">
            <button onClick={close} className="le-tap px-3 py-1.5 text-[12px] font-semibold rounded-md border border-line bg-field text-fg-2 hover:text-fg transition-colors">{run.running ? 'Close' : 'Cancel'}</button>
            {run.running
              ? <button onClick={stopConsolidate} className="le-tap ml-auto px-4 py-1.5 text-[12px] font-bold rounded-md bg-red-500/90 text-white hover:bg-red-500 transition-colors">Stop Consolidation</button>
              : (
                <div className="ml-auto flex items-center gap-2">
                  <button onClick={() => { addConsoJob({ itemId: id, itemName: n, assets, recipient, amount: amt }); close(); }} disabled={mog || incoming <= 0 || amt <= 0 || !recipient} className="le-tap px-3 py-1.5 text-[12px] font-semibold rounded-md border border-line bg-field text-fg-2 enabled:hover:text-fg disabled:opacity-40 transition-colors">Add to Queue</button>
                  <button onClick={start} disabled={!canRun} className="le-tap px-4 py-1.5 text-[12px] font-bold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors">Consolidate{amt > 0 && amt < incoming ? ` ${amt}` : ''}</button>
                </div>
              )}
          </div>
        </>
      )}
    </Modal>
  );
}
