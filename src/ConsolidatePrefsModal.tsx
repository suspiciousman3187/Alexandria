import { useEffect, useMemo, useState } from 'react';
import { Modal } from './overlay';
import { IconInner } from './atlasIcon';
import { useKnownCharacters, useAvailableIcons } from './bridge';
import { useConsolidate, clearConsolidate, stopConsolidate, incomingTotal, recipientSpaceMulti } from './consolidate';
import { useConsolidatePrefs, runConsolidatePrefs, stopConsolidatePrefs } from './consolidatePrefs';
import { useItemNames, resolveItemName } from './itemNames';
import ConsoProgress from './ConsoProgress';
import { useSettings } from './settings';
import { useAnon } from './anonymize';

const STATUS_DOT: Record<string, string> = { pending: 'bg-fg-4', moving: 'bg-sky-400', trading: 'bg-amber-400', ok: 'bg-emerald-400', fail: 'bg-red-400' };
const STATUS_LABEL: Record<string, string> = { pending: 'Waiting', moving: 'Gathering', trading: 'Trading', ok: 'Done', fail: 'Failed' };

export default function ConsolidatePrefsModal({ onClose }: { onClose: () => void }) {
  const known = useKnownCharacters();
  const iconSet = useAvailableIcons();
  const exp = useSettings().experimentalFeatures;
  const anon = useAnon();
  const prefs = useConsolidatePrefs();
  const run = useConsolidate();
  const db = useItemNames();
  const [running, setRunning] = useState(false);
  useEffect(() => { clearConsolidate(); }, []);

  const assetsFor = (name: string) => known.find((k) => k.name === name)?.assets;

  const plan = useMemo(() => {
    const out: { holder: string; online: boolean; items: { id: number; n: string; incoming: number; leftover: number }[]; total: number; fit: number; leftover: number; slotsFree: number }[] = [];
    for (const [holder, items] of Object.entries(prefs)) {
      if (!items.length) continue;
      const holderChar = known.find((k) => k.name === holder);
      const resolved = items.map((nm) => { const it = resolveItemName(nm); return it ? { id: it.id, n: it.n } : { id: 0, n: nm }; });
      const space = recipientSpaceMulti(holder, resolved.filter((r) => r.id > 0).map((r) => r.id), exp);
      const fitById = new Map(space.perItem.map((pi) => [pi.id, pi]));
      const rows = resolved.map((r) => { const pi = fitById.get(r.id); return { id: r.id, n: r.n, incoming: pi?.incoming ?? incomingTotal(holder, r.id, exp), leftover: pi?.leftover ?? 0 }; });
      out.push({ holder, online: !!holderChar?.online, items: rows, total: rows.reduce((s, r) => s + r.incoming, 0), fit: space.totalFit, leftover: space.totalLeftover, slotsFree: space.slotsFree });
    }
    return out.sort((a, b) => a.holder.localeCompare(b.holder));
  }, [prefs, known, exp, db]);

  const grandTotal = plan.reduce((s, p) => s + p.total, 0);
  const busy = running || run.running;

  const doRun = async () => { setRunning(true); try { await runConsolidatePrefs(exp); } finally { setRunning(false); } };
  const doStop = () => { stopConsolidatePrefs(); stopConsolidate(); };

  return (
    <Modal onClose={onClose} panelClass="w-[min(94vw,460px)] max-h-[88vh]">
      {(close) => (
        <div className="flex flex-col min-h-0">
          <div className="shrink-0 px-4 pt-4 pb-3 border-b border-line">
            <h2 className="text-[14px] font-bold text-fg">Consolidate By Preference</h2>
            <p className="text-[11px] text-fg-4 mt-1 leading-snug">Consolidate specific items to the characters defined in your Preferences List.</p>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
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

            {grandTotal === 0 && !busy ? (
              <div className="rounded-md bg-field border border-line px-3 py-2 text-[11px] text-fg-4">Nothing to move. Characters need to be within trading distance (6y) to consolidate together.</div>
            ) : (
              plan.map((p) => (
                <div key={p.holder} className="rounded-lg border border-line bg-surface overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-line">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${p.online ? 'bg-emerald-400' : 'bg-fg-4'}`} />
                    <span className="text-[12px] font-bold text-fg truncate">{anon(p.holder)}</span>
                    {p.leftover > 0
                      ? <span className="ml-auto text-[11px] tabular-nums shrink-0"><span className="text-fg-3">{p.fit} fit</span> <span className="text-amber-400">· {p.leftover} won't fit</span></span>
                      : <span className="ml-auto text-[11px] text-fg-4 tabular-nums shrink-0">{p.total} incoming</span>}
                  </div>
                  {p.leftover > 0 && <div className="px-3 py-1 text-[10px] text-amber-400/90 bg-amber-400/5">{anon(p.holder)} has {p.slotsFree} free slot{p.slotsFree === 1 ? '' : 's'} — only what fits will be sent.</div>}
                  <div className="divide-y divide-line">
                    {p.items.map((r) => (
                      <div key={r.n} className="flex items-center gap-2 px-3 py-1.5">
                        <div className="shrink-0 w-5 h-5 rounded bg-field grid place-items-center overflow-hidden"><IconInner id={r.id} size={20} name={r.n} assets={assetsFor(p.holder)} bmpHas={r.id > 0 && iconSet.has(r.id)} /></div>
                        <span className="min-w-0 flex-1 truncate text-[11px] text-fg-2">{r.n}</span>
                        {r.leftover > 0 && <span className="text-[10px] tabular-nums shrink-0 text-amber-400">{r.leftover} over</span>}
                        <span className={`text-[11px] tabular-nums font-semibold shrink-0 ${r.incoming > 0 ? 'text-fg' : 'text-fg-4'}`}>{r.incoming > 0 ? `×${r.incoming}` : 'none nearby'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="shrink-0 flex items-center gap-2 p-4 pt-3 border-t border-line">
            <button onClick={close} className="le-tap px-3 py-1.5 text-[12px] font-semibold rounded-md border border-line bg-field text-fg-2 hover:text-fg transition-colors">{busy ? 'Close' : 'Cancel'}</button>
            {busy
              ? <button onClick={doStop} className="le-tap ml-auto px-4 py-1.5 text-[12px] font-bold rounded-md bg-red-500/90 text-white hover:bg-red-500 transition-colors">Stop</button>
              : <button onClick={() => void doRun()} disabled={grandTotal === 0} className="le-tap ml-auto px-4 py-2 text-[12px] font-bold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors">Consolidate By Preference</button>}
          </div>
        </div>
      )}
    </Modal>
  );
}
