import { useAhServerHealth, rescanAhServers } from './bridge';
import { Collapse } from './overlay';

export function ServerHealthRow() {
  const h = useAhServerHealth();
  const label = h.scanning ? 'Scanning 124.150.154.0/24…'
    : h.health === 'ok' ? `Healthy · base 124.150.154.${h.base}`
      : h.health === 'degraded' ? 'Unreachable'
        : 'Not checked yet';
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5">
      <div className="min-w-0">
        <div className="text-[13px] text-fg-2 leading-tight flex items-center gap-2">
          Market Servers
          <span className={`w-1.5 h-1.5 rounded-full ${h.health === 'ok' ? 'bg-emerald-400' : h.health === 'degraded' ? 'bg-red-400' : 'bg-fg-4'}`} />
        </div>
        <div className="text-[11px] text-fg-4 mt-0.5 leading-snug tabular-nums">{label}</div>
      </div>
      <button
        onClick={() => void rescanAhServers()}
        disabled={h.scanning}
        className="ml-auto shrink-0 px-3 py-1.5 text-[12px] font-semibold rounded-md border border-line bg-surface text-fg-2 hover:text-fg disabled:opacity-40 transition-colors"
      >{h.scanning ? 'Scanning…' : 'Re-scan'}</button>
    </div>
  );
}

export function ServerHealthBanner() {
  const h = useAhServerHealth();
  return (
    <Collapse open={h.health === 'degraded' || h.scanning}>
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-[12px] text-amber-200">
        <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /></svg>
        <span className="min-w-0 flex-1">{h.scanning ? 'Rediscovering auction servers…' : 'Auction servers unreachable. Prices may be unavailable.'}</span>
        <button onClick={() => void rescanAhServers()} disabled={h.scanning} className="le-tap shrink-0 px-2.5 py-1 text-[11px] font-semibold rounded border border-amber-500/40 text-amber-100 hover:bg-amber-500/15 disabled:opacity-50 transition-colors">{h.scanning ? 'Scanning…' : 'Re-scan'}</button>
      </div>
    </Collapse>
  );
}
