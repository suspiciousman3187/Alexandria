import { useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { inTauri, useKnownCharacters } from './bridge';
import { useItemValues } from './priceStore';
import { useSettings } from './settings';

// Forward the AH prices of the current treasure-pool items to Sage's master overlay (via the Rust
// `sage_pool_prices` command -> 127.0.0.1:2027). Sage can't query the private-server search protocol
// itself; we already fetch these prices for the desktop pool view, so we just relay them by item id. A
// no-op when Sage isn't running (the socket connect is refused). Called once at app root.
export function usePoolPriceTee() {
  const known = useKnownCharacters();
  const world = useSettings().ahServer || known.find((c) => c.online)?.server;
  const ids = useMemo(() => {
    const s = new Set<number>();
    for (const c of known) if (c.online) for (const it of c.pool ?? []) s.add(it.id);
    return [...s].sort((a, b) => a - b);
  }, [known]);
  const single = useItemValues(world, ids, false);
  const stack = useItemValues(world, ids, true);
  // Single + stack median/listed per pool item (Sage renders whichever the item's price-display mode picks),
  // only for ones we have a price for.
  const prices = ids
    .map((id) => {
      const s = single.get(id); const k = stack.get(id);
      return { id, median: Math.round(s?.median ?? 0), listed: s?.listedTotal ?? 0, smedian: Math.round(k?.median ?? 0), slisted: k?.listedTotal ?? 0 };
    })
    .filter((p) => p.median > 0 || p.listed > 0 || p.smedian > 0);
  // Push only when the actual numbers change, not on every render (useItemValues returns a fresh map).
  const sig = prices.map((p) => `${p.id}:${p.median}:${p.listed}:${p.smedian}:${p.slisted}`).join(',');
  useEffect(() => {
    if (!inTauri || prices.length === 0) return;
    void invoke('sage_pool_prices', { prices }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
}
