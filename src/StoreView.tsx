import { useMemo, useState } from 'react';
import { useKnownCharacters, useAvailableIcons, storeRequest, storeStop, type KnownChar } from './bridge';
import { IconInner } from './atlasIcon';
import { Group, Stepper } from './ui';
import { useSettings } from './settings';
import { useAnon } from './anonymize';
import { OpGlyph } from './OpCard';

const fmt = (v: number) => v.toLocaleString();

type Holder = { c: KnownChar; count: number };
type ItemAgg = { id: number; n: string; holders: Holder[]; total: number };
type NpcAgg = { npc: string; chars: KnownChar[]; items: ItemAgg[] };

function Icon({ id, n, assets, iconSet }: { id: number; n: string; assets?: string; iconSet: Set<number> }) {
  return (
    <div className="relative shrink-0 w-7 h-7 rounded bg-field grid place-items-center overflow-hidden">
      <IconInner id={id} size={28} name={n} assets={assets} bmpHas={id > 0 && iconSet.has(id)} />
    </div>
  );
}

function CharProgress({ c }: { c: KnownChar }) {
  const sp = c.store;
  if (!sp || (!sp.active && !sp.done)) return <span className="text-[10px] text-fg-4 tabular-nums shrink-0">idle</span>;
  if (sp.active) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-accent shrink-0">
        <OpGlyph state="active" className="w-3 h-3" />
        <span className="tabular-nums">{sp.done}/{sp.total}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-300 shrink-0">
      <OpGlyph state="ok" className="w-3 h-3" />stored {sp.done}
    </span>
  );
}

export default function StoreView() {
  const known = useKnownCharacters();
  const anon = useAnon();
  const exp = useSettings().experimentalFeatures;
  const iconSet = useAvailableIcons();
  const online = useMemo(() => known.filter((k) => k.online && k.conn != null), [known]);
  const assetsAny = useMemo(() => online.find((c) => c.assets)?.assets, [online]);

  const [amounts, setAmounts] = useState<Record<string, number>>({});

  const npcs = useMemo<NpcAgg[]>(() => {
    const m = new Map<string, { chars: Set<KnownChar>; items: Map<number, ItemAgg> }>();
    for (const c of online) {
      for (const z of c.storeZone ?? []) {
        let e = m.get(z.npc);
        if (!e) { e = { chars: new Set(), items: new Map() }; m.set(z.npc, e); }
        e.chars.add(c);
        for (const it of z.items) {
          let ia = e.items.get(it.id);
          if (!ia) { ia = { id: it.id, n: it.n, holders: [], total: 0 }; e.items.set(it.id, ia); }
          if (it.c > 0) { ia.holders.push({ c, count: it.c }); ia.total += it.c; }
        }
      }
    }
    return [...m.entries()].map(([npc, e]) => ({
      npc,
      chars: [...e.chars],
      items: [...e.items.values()].sort((a, b) => a.id - b.id),
    })).sort((a, b) => a.npc.localeCompare(b.npc));
  }, [online]);

  const zoneChars = useMemo(() => {
    const s = new Set<KnownChar>();
    for (const n of npcs) for (const c of n.chars) s.add(c);
    return [...s].sort((a, b) => a.name.localeCompare(b.name));
  }, [npcs]);
  const anyStoring = online.some((c) => c.store?.active);

  // Store up to `amount` of the item across the holders (fleet pool), capped per holder.
  const storeAmount = (npc: string, ia: ItemAgg, amount: number) => {
    let remaining = Math.max(0, Math.min(amount, ia.total));
    for (const h of ia.holders) {
      if (remaining <= 0) break;
      const n = Math.min(remaining, h.count);
      if (h.c.conn != null && n > 0) storeRequest(h.c.conn, npc, ia.id, n);
      remaining -= n;
    }
  };
  const amtOf = (ia: ItemAgg) => Math.max(1, Math.min(amounts[`${ia.id}`] ?? ia.total, ia.total));
  const storeNpcAll = (n: NpcAgg) => { for (const ia of n.items) storeAmount(n.npc, ia, ia.total); };
  const stopAll = () => { for (const c of online) if (c.conn != null) storeStop(c.conn); };

  if (online.length === 0) {
    return (
      <div className="h-full grid place-items-center">
        <div className="text-center max-w-sm px-6">
          <div className="text-[15px] font-bold text-fg mb-1">No Characters Connected</div>
          <div className="text-[12px] text-fg-4 leading-relaxed">Store Materials trades storable items (Rem's Tale, Oboro materials, Alexandrite, Crystals) to their storage NPC{exp ? ' from anywhere in the zone' : ' when standing next to it'}. Load the Alexandria addon in-game.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-3 pt-3 pb-2 border-b border-line flex flex-col gap-2 max-w-2xl w-full mx-auto">
        <div className="flex items-center gap-2">
          <div className="text-[12px] text-fg-4 flex-1">{npcs.length === 0 ? (exp ? 'No storage NPC in any character’s zone' : 'No storage NPC nearby') : `${npcs.length} storage NPC${npcs.length === 1 ? '' : 's'} ${exp ? 'in zone' : 'nearby'}`}</div>
          <button onClick={stopAll} disabled={!anyStoring} className="le-tap shrink-0 px-3 py-1.5 text-[11px] font-semibold rounded-md border border-line bg-surface text-fg-3 enabled:hover:text-fg disabled:opacity-40 transition-colors">Stop All</button>
        </div>
        {zoneChars.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(6.75rem,1fr))] gap-1.5">
            {zoneChars.map((c) => (
              <span key={c.name} className="flex items-center gap-1.5 min-w-0 px-2 py-0.5 rounded-full bg-field border border-line text-[10px]">
                <span className="font-semibold text-fg-3 truncate flex-1">{anon(c.name)}</span>
                <CharProgress c={c} />
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-3 max-w-2xl w-full mx-auto flex flex-col gap-4">
          {npcs.length === 0 ? (
            <div className="grid place-items-center py-16 text-center px-6">
              <div className="max-w-sm">
                <div className="text-[13px] font-semibold text-fg-2 mb-1">{exp ? 'Not In A Storage Zone' : 'Not Near A Storage NPC'}</div>
                <div className="text-[12px] text-fg-4 leading-relaxed">{exp ? 'Move a character into the zone of a storage NPC' : 'Stand a character next to a storage NPC'} (Monisette, Oboro, Paparoon, Oseem, or an Ephemeral Moogle). What each NPC accepts, and how much you hold, will appear here.</div>
              </div>
            </div>
          ) : (
            npcs.map((n) => (
              <Group key={n.npc} title={`${n.npc}`} right={
                <span className="flex items-center gap-2 text-[11px]">
                  <span className="text-fg-4">{n.chars.length} char{n.chars.length === 1 ? '' : 's'} in zone</span>
                  <button onClick={() => storeNpcAll(n)} className="le-tap font-semibold text-accent hover:text-accent-hover">Store All</button>
                </span>
              }>
                {n.items.map((ia) => {
                  const has = ia.total > 0;
                  return (
                    <div key={ia.id} className={`flex items-center gap-2.5 px-3 py-2 ${has ? '' : 'opacity-45'}`}>
                      <Icon id={ia.id} n={ia.n} assets={assetsAny} iconSet={iconSet} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-semibold text-fg-2 truncate">{ia.n}</div>
                        <div className="text-[10px] text-fg-4">
                          {has ? (
                            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                              {ia.holders.length > 1 && <span className="font-semibold text-fg-3">{fmt(ia.total)} total</span>}
                              {ia.holders.map((h, i) => (
                                <span key={h.c.name} className="whitespace-nowrap">
                                  {(ia.holders.length > 1 || i > 0) && <span className="text-fg-4/50">· </span>}
                                  <span className="text-fg-3">{anon(h.c.name)}</span> {fmt(h.count)}
                                  {h.c.store?.active && h.c.store.item === ia.id && <span className="text-accent"> storing…</span>}
                                </span>
                              ))}
                            </span>
                          ) : 'none held'}
                        </div>
                      </div>
                      {has ? (
                        <>
                          <Stepper value={amtOf(ia)} min={1} max={ia.total} onChange={(v) => setAmounts((a) => ({ ...a, [`${ia.id}`]: v }))} className="shrink-0" />
                          <button onClick={() => storeAmount(n.npc, ia, amtOf(ia))} className="le-tap shrink-0 px-3 py-1.5 text-[11px] font-bold rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors">Store</button>
                        </>
                      ) : (
                        <span className="shrink-0 text-[10px] text-fg-4">none</span>
                      )}
                    </div>
                  );
                })}
              </Group>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
