import { useEffect } from 'react';
import { useConsolidate, stopConsolidate, clearConsolidate } from './consolidate';
import { useAnon } from './anonymize';
import ConsoProgress from './ConsoProgress';

const STATUS_DOT: Record<string, string> = { pending: 'bg-fg-4', moving: 'bg-sky-400', trading: 'bg-amber-400', ok: 'bg-emerald-400', fail: 'bg-red-400' };
const STATUS_LABEL: Record<string, string> = { pending: 'Waiting', moving: 'Gathering', trading: 'Trading', ok: 'Done', fail: 'Failed' };

// Floating progress card for send/consolidate runs kicked off from places that have no
// progress UI of their own (Library "Send To", "Gather", drag-drop send). It reads the
// global run store, so it appears whenever a run is active and auto-dismisses a few
// seconds after it finishes; Stop cancels an in-flight run.
export default function ConsolidateProgressCard() {
  const run = useConsolidate();
  const anon = useAnon();
  const active = run.running || run.order.length > 0;
  useEffect(() => {
    if (!run.running && run.order.length > 0) {
      const t = window.setTimeout(() => clearConsolidate(), 6000);
      return () => window.clearTimeout(t);
    }
  }, [run.running, run.order.length]);
  if (!active) return null;
  const failed = run.order.some((n) => run.chars[n]?.status === 'fail');
  return (
    <div className="fixed bottom-4 right-4 z-40 w-[min(92vw,320px)] rounded-lg border border-line bg-surface shadow-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-line">
        <span className="text-[11px] font-bold text-fg shrink-0">{run.running ? 'Sending' : failed ? 'Send Finished' : 'Send Complete'}</span>
        {run.collector && <span className="text-[10px] text-fg-4 min-w-0 truncate">to {anon(run.collector)}</span>}
        {run.running
          ? <button onClick={stopConsolidate} className="ml-auto shrink-0 px-2 py-0.5 text-[10px] font-bold rounded border border-red-400/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 transition-colors">Stop</button>
          : <button onClick={clearConsolidate} className="ml-auto shrink-0 px-2 py-0.5 text-[10px] font-semibold rounded border border-line text-fg-3 hover:text-fg transition-colors">Dismiss</button>}
      </div>
      <ConsoProgress />
      <div className="max-h-40 overflow-y-auto divide-y divide-line">
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
      </div>
      {run.error && <div className="px-3 py-1.5 text-[10px] text-red-300 border-t border-line">{run.error}</div>}
    </div>
  );
}
