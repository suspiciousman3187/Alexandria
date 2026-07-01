import { useEffect, useState } from 'react';
import { fetchMarket, type MarketData } from './bridge';
import { fmtGilStr, rateInfo } from './marketFmt';

const fmtGil = (v: number) => v.toLocaleString();

// Module-level cache so toggling single/stack or reopening a sell modal doesn't
// re-hit FFXIAH for a page already fetched this session.
const marketCache = new Map<string, MarketData>();

function PlayerName({ name }: { name?: string }) {
  if (!name) return <span className="text-fg-4">—</span>;
  return <span className="text-fg-3 truncate max-w-full">{name}</span>;
}

function StockPill({ stock }: { stock: string }) {
  const has = Number(stock) > 0;
  return (
    <span className={`inline-flex items-baseline gap-1 rounded-md border px-1.5 py-0.5 ${has ? 'border-emerald-500/30 bg-emerald-500/15' : 'border-red-500/30 bg-red-500/15'}`}>
      <span className={`text-[13px] font-extrabold tabular-nums leading-none ${has ? 'text-emerald-300' : 'text-red-300'}`}>{has ? fmtGilStr(stock) : '0'}</span>
      <span className={`text-[9px] font-semibold ${has ? 'text-emerald-300/80' : 'text-red-300/80'}`}>in stock</span>
    </span>
  );
}

export function MarketBlock({ data }: { data: MarketData }) {
  const rate = rateInfo(data.rate);
  const hasMarket = !!(data.median || data.stock);
  const last = data.sales[0]?.price ?? null;
  const med = data.median ? Number(String(data.median).replace(/[^\d]/g, '')) : null;
  const lastCls = last == null || med == null || last === med ? 'text-fg-2' : last < med ? 'text-emerald-300' : 'text-red-300';
  return (
    <div className="rounded-lg border border-line bg-field/40 p-3 flex flex-col gap-2.5">
      {hasMarket ? (
        <div className="flex flex-col gap-2">
          {rate && (
            <div className="flex items-center gap-2.5 text-[11px]">
              <span className="w-14 shrink-0 text-fg-4">Rate</span>
              <span><span className={`font-bold ${rate.cls}`}>{rate.label}</span> <span className="text-fg-4">({rate.perDay} sold/day)</span></span>
            </div>
          )}
          <div className="flex items-baseline gap-2.5">
            <span className="w-14 shrink-0 text-[11px] text-fg-4">Median</span>
            {data.median
              ? <span className="text-[20px] font-extrabold text-fg tabular-nums leading-none">{fmtGilStr(data.median)}<span className="text-[11px] font-semibold text-fg-3"> gil</span></span>
              : <span className="text-[13px] font-semibold text-fg-4">—</span>}
            {data.stock && <StockPill stock={data.stock} />}
          </div>
          {last != null && (
            <div className="flex items-baseline gap-2.5">
              <span className="w-14 shrink-0 text-[11px] text-fg-4">Last Sold</span>
              <span className={`text-[14px] font-bold tabular-nums leading-none ${lastCls}`}>{fmtGil(last)}<span className="text-[10px] font-semibold text-fg-4"> gil</span></span>
              {data.sales[0]?.date && <span className="text-[10px] text-fg-4 tabular-nums">{data.sales[0].date}</span>}
            </div>
          )}
        </div>
      ) : (
        <div className="text-[11px] text-fg-4">No market data for this item.</div>
      )}
      {data.sales.length > 0 && (
        <div className="pt-2.5 border-t border-line">
          <div className="text-[9px] font-bold uppercase tracking-wider text-fg-4 mb-1.5">Price History · {data.sales.length}</div>
          <div className="overflow-auto -mx-3 px-3 max-h-[148px]">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-field/40 backdrop-blur-sm">
                <tr className="text-left text-[10px] font-bold uppercase tracking-wide text-fg-4 border-b border-line">
                  <th className="py-1.5 pr-2 font-bold">Date</th>
                  <th className="py-1.5 px-2 font-bold">Seller</th>
                  <th className="py-1.5 px-2 font-bold">Buyer</th>
                  <th className="py-1.5 pl-2 font-bold text-right">Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.sales.map((s, i) => (
                  <tr key={i} className="hover:bg-field/40">
                    <td className="py-1.5 pr-2 text-fg-4 tabular-nums whitespace-nowrap">{s.date}</td>
                    <td className="py-1.5 px-2 max-w-[110px]"><PlayerName name={s.seller} /></td>
                    <td className="py-1.5 px-2 max-w-[110px]"><PlayerName name={s.buyer} /></td>
                    <td className="py-1.5 pl-2 text-fg-2 font-semibold tabular-nums text-right whitespace-nowrap">{fmtGil(s.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// Auto-fetches and renders market data for the given item/stack, re-fetching
// when either changes. Used in the sell flows where you're pricing one item.
export function MarketLookup({ id, stack, server }: { id: number; stack: boolean; server?: string }) {
  const [data, setData] = useState<MarketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    const key = `${id}:${stack ? 1 : 0}:${server ?? ''}`;
    const cached = marketCache.get(key);
    if (cached) { setData(cached); setLoading(false); setErr(''); return; }
    let cancelled = false;
    setLoading(true); setErr(''); setData(null);
    fetchMarket(id, stack, server)
      .then((d) => { if (!cancelled) { marketCache.set(key, d); setData(d); } })
      .catch((e) => { if (!cancelled) setErr(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id, stack, server]);

  if (loading) return <div className="text-[11px] text-fg-4 px-0.5">Loading recent {stack ? 'stack' : 'single'} prices…</div>;
  if (err) return <div className="text-[11px] text-red-300 px-0.5">Couldn't load prices: {err}</div>;
  if (!data) return null;
  return <MarketBlock data={data} />;
}
