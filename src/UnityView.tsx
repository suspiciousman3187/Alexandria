import { useMemo, useState } from 'react';
import { useKnownCharacters, useAvailableIcons, nomadReachable, unityReinforce, unityOpen, unityStop, NOMAD_BAGS, type KnownChar, type InvItem } from './bridge';
import { IconInner } from './atlasIcon';
import { CharacterSelect, SearchInput, Stepper } from './ui';
import { Modal } from './overlay';
import { useStickyChar, useSticky } from './sticky';
import { useSettings } from './settings';
import { ALWAYS_BAGS, MOG_ONLY_BAGS } from './bagConstants';
import {
  UNITY_BY_ID, LUSTRELESS_ID, LUSTRELESS_NAME, RANK_TOTAL, UNITY_MAX_RANK,
  UNITY_CAT_ORDER, UNITY_CAT_LABEL, UNITY_OPEN_ACCOLADES, UNITY_ACCOLADES_NAME,
  lustrelessNeeded, type Lustreless, type UnityCat,
} from './unityAugData';

const LUS_LABEL: Record<Lustreless, string> = { scale: 'Scale', hide: 'Hide', wing: 'Wing' };

function Icon({ id, n, assets, iconSet, size = 28 }: { id: number; n: string; assets?: string; iconSet: Set<number>; size?: number }) {
  return (
    <div className="relative shrink-0 rounded bg-field grid place-items-center overflow-hidden" style={{ width: size, height: size }}>
      <IconInner id={id} size={size} name={n} assets={assets} bmpHas={id > 0 && iconSet.has(id)} />
    </div>
  );
}

const bagReachable = (bagId: number, mog: boolean, nomadOk: boolean): boolean =>
  ALWAYS_BAGS.has(bagId) || (MOG_ONLY_BAGS.has(bagId) && (mog || (NOMAD_BAGS.has(bagId) && nomadOk)));

type Piece = { id: number; name: string; bag: number; slot: number; rank: number | null; acc: number; lustreless: Lustreless; cat: UnityCat };

export default function UnityView() {
  const known = useKnownCharacters();
  const iconSet = useAvailableIcons();
  const exp = useSettings().experimentalFeatures;
  const [name, setName] = useStickyChar();
  const [q, setQ] = useState('');
  const [targets, setTargets] = useState<Record<string, number>>({}); // pieceKey -> target rank
  const [confirm, setConfirm] = useState<{ kind: 'augment' | 'open'; id: number; name: string; lustreless: Lustreless; count: number; from: number; to: number; bag: number; slot: number } | null>(null);

  const online = useMemo(() => known.filter((k) => k.online && k.conn != null), [known]);
  const active: KnownChar | undefined = online.find((k) => k.name === name) ?? online[0];
  const assets = active?.assets;
  const nomadOk = nomadReachable(active, exp);
  const conciergeNear = !!active?.vendorNear?.unity;
  const conn = active?.conn ?? null;
  const run = active?.unity;
  const running = !!run?.active;
  // Unity Accolades balance (needed to OPEN a fresh +1). Undefined until the currency page arrives.
  const accolades = active?.cur?.list.find((e) => e.n === UNITY_ACCOLADES_NAME)?.v;

  // Lustreless held across reachable bags (inventory + storage when the mog bags are reachable), since the
  // executor pulls from storage before trading.
  const lustCount = useMemo(() => {
    const c: Record<Lustreless, number> = { scale: 0, hide: 0, wing: 0 };
    for (const b of active?.inv ?? []) {
      if (!bagReachable(b.id, !!active?.mog, nomadOk)) continue;
      for (const it of b.items) {
        if (it.id === LUSTRELESS_ID.scale) c.scale += it.c;
        else if (it.id === LUSTRELESS_ID.hide) c.hide += it.c;
        else if (it.id === LUSTRELESS_ID.wing) c.wing += it.c;
      }
    }
    return c;
  }, [active?.inv, active?.mog, nomadOk]);

  const pieces = useMemo(() => {
    const out: Piece[] = [];
    const search = q.trim().toLowerCase();
    for (const b of active?.inv ?? []) {
      if (!bagReachable(b.id, !!active?.mog, nomadOk)) continue;
      for (const it of b.items as InvItem[]) {
        const ce = UNITY_BY_ID.get(it.id);
        if (!ce) continue;
        if (search && !it.n.toLowerCase().includes(search)) continue;
        out.push({ id: it.id, name: it.n, bag: b.id, slot: it.s, rank: it.ur ?? null, acc: it.ua ?? 0, lustreless: ce.lustreless, cat: ce.cat });
      }
    }
    // Lowest rank first (most work to do surfaces together), then name.
    out.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || a.name.localeCompare(b.name));
    return out;
  }, [active?.inv, active?.mog, nomadOk, q]);

  const groups = useMemo(() => {
    const g: Record<UnityCat, Piece[]> = { weapon: [], armor: [], accessory: [] };
    for (const p of pieces) g[p.cat].push(p);
    return g;
  }, [pieces]);
  const [collapsed, setCollapsed] = useSticky<string[]>('unity.collapsed', []);
  const toggleCat = (c: UnityCat) => setCollapsed((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));

  if (online.length === 0) {
    return (
      <div className="h-full grid place-items-center p-6">
        <div className="text-center max-w-sm">
          <div className="text-[15px] font-bold text-fg mb-1">No Characters Connected</div>
          <div className="text-[12px] text-fg-4 leading-relaxed">Unity reinforcement acts on a live character. Load the Alexandria addon in-game.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-4 pt-3 pb-3 border-b border-line flex flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0"><CharacterSelect value={active?.name ?? ''} onChange={setName} chars={online} /></div>
          <span className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[11px] font-semibold ${conciergeNear ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-line bg-field text-fg-4'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${conciergeNear ? 'bg-emerald-400' : 'bg-fg-4'}`} />
            Unity NPC Nearby
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(['scale', 'hide', 'wing'] as Lustreless[]).map((l) => (
            <span key={l} className="flex items-center gap-2 px-3 py-2 rounded-md border border-line bg-field">
              <Icon id={LUSTRELESS_ID[l]} n={LUSTRELESS_NAME[l]} assets={assets} iconSet={iconSet} size={24} />
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] text-fg-4 leading-tight truncate">{LUS_LABEL[l]}</span>
                <span className="block text-[14px] font-bold tabular-nums text-fg-2 leading-tight">{lustCount[l]}</span>
              </span>
            </span>
          ))}
        </div>
        <SearchInput value={q} onChange={setQ} wrap="" placeholder="Filter Unity gear…" className="bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 transition-colors" />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-3">
        {running && (
          <div className="rounded-lg border border-accent/40 bg-accent/10 px-3.5 py-2.5 flex items-center gap-3">
            <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0 animate-spin text-accent" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.6" /></svg>
            <div className="min-w-0 flex-1 text-[12px] text-fg-2 truncate">{run?.mode === 'open' ? 'Opening' : 'Augmenting'}: {run?.status || run?.phase || 'working'}{run?.mode !== 'open' && run?.want ? ` · ${run.done ?? 0}/${run.want} lustreless` : ''}</div>
            {conn != null && <button onClick={() => unityStop(conn)} className="le-tap shrink-0 px-2.5 py-1 text-[11px] font-bold rounded-md bg-red-500/90 text-white hover:bg-red-500 transition-colors">Stop</button>}
          </div>
        )}
        {pieces.length === 0 ? (
          <div className="text-center text-[12px] text-fg-4 py-10">No Unity (+1) gear found in reachable bags{q.trim() ? ' for that filter' : ''}. Hold a Unity +1 piece to augment it.</div>
        ) : (
          UNITY_CAT_ORDER.filter((c) => groups[c].length > 0).map((c) => {
            const open = !collapsed.includes(c);
            return (
              <div key={c} className="flex flex-col gap-1.5">
                <button onClick={() => toggleCat(c)} className="le-tap w-full flex items-center gap-2 px-2 py-1.5 text-left rounded-md hover:bg-field/40 transition-colors">
                  <svg viewBox="0 0 24 24" className={`w-3 h-3 shrink-0 text-fg-4 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-fg-3">{UNITY_CAT_LABEL[c]}</span>
                  <span className="text-[11px] text-fg-4 tabular-nums">{groups[c].length}</span>
                </button>
                {open && (
                  <div className="rounded-lg border border-line bg-surface divide-y divide-line overflow-hidden">
                    {groups[c].map((p) => {
                      const key = `${p.bag}:${p.slot}:${p.id}`;
                      const isNew = p.rank == null;        // no stored augment data = brand-new, Rank 0
                      const rank = p.rank ?? 0;
                      const maxed = rank >= UNITY_MAX_RANK;
                      const target = Math.min(UNITY_MAX_RANK, Math.max(rank + 1, targets[key] ?? UNITY_MAX_RANK));
                      const remaining = maxed ? 0 : Math.max(0, (RANK_TOTAL[rank] ?? 0) - p.acc);
                      const need = lustrelessNeeded(rank, remaining, target);
                      const have = lustCount[p.lustreless];
                      const short = Math.max(0, need - have);
                      return (
                        <div key={key} className="flex items-center gap-2.5 py-2 px-3">
                          <Icon id={p.id} n={p.name} assets={assets} iconSet={iconSet} size={30} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-[12px] font-semibold text-fg-2 truncate">{p.name}</span>
                              <Icon id={LUSTRELESS_ID[p.lustreless]} n={LUSTRELESS_NAME[p.lustreless]} assets={assets} iconSet={iconSet} size={14} />
                            </div>
                            <div className="text-[11px] text-fg-4 truncate">
                              {maxed
                                ? <span className="text-emerald-300 font-semibold">Max rank (R15)</span>
                                : <>R{rank}<span className="text-fg-5">/15</span>{isNew && <span className="text-sky-300"> new</span>} · <span className="tabular-nums text-fg-3">{remaining}</span> RP to R{rank + 1}</>}
                            </div>
                          </div>
                          {isNew ? (() => {
                            // Unopened: the only action is Open (trade piece + 1 lustreless + 30,000 accolades). No rank target yet.
                            const canAfford = accolades == null || accolades >= UNITY_OPEN_ACCOLADES;
                            const canOpen = conn != null && conciergeNear && have >= 1 && canAfford && !running;
                            return (
                              <>
                                <div className="shrink-0">
                                  <div className="text-[9px] uppercase tracking-wide text-fg-5 leading-none text-right mb-0.5">Cost</div>
                                  <div className="flex items-center gap-1 justify-end">
                                    <Icon id={LUSTRELESS_ID[p.lustreless]} n={LUSTRELESS_NAME[p.lustreless]} assets={assets} iconSet={iconSet} size={16} />
                                    <span className="text-[11px] font-semibold tabular-nums text-fg-3 leading-none whitespace-nowrap">1 + <span className={accolades != null && accolades < UNITY_OPEN_ACCOLADES ? 'text-rose-300' : 'text-emerald-300'}>30k Accolades</span></span>
                                  </div>
                                </div>
                                <button
                                  onClick={() => { if (canOpen) setConfirm({ kind: 'open', id: p.id, name: p.name, lustreless: p.lustreless, count: 1, from: 0, to: 1, bag: p.bag, slot: p.slot }); }}
                                  disabled={!canOpen}
                                  title={!conciergeNear ? 'Go to a Unity NPC' : have < 1 ? `Need 1 ${LUSTRELESS_NAME[p.lustreless]}` : !canAfford ? `Need ${UNITY_OPEN_ACCOLADES.toLocaleString()} Unity Accolades` : running ? 'A unity action is already running' : undefined}
                                  className="le-tap shrink-0 px-3 py-1.5 text-[12px] font-bold rounded-md bg-sky-500 text-white hover:bg-sky-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                  Open
                                </button>
                              </>
                            );
                          })() : !maxed && (
                            <>
                              <Stepper value={target} min={rank + 1} max={UNITY_MAX_RANK} onChange={(v) => setTargets((t) => ({ ...t, [key]: v }))} numW="w-8" className="shrink-0" />
                              <div className="shrink-0 w-14 text-right">
                                <div className="text-[9px] uppercase tracking-wide text-fg-5 leading-none">Need</div>
                                <div className={`text-[13px] font-bold tabular-nums leading-tight ${short > 0 ? 'text-rose-300' : 'text-emerald-300'}`}>{need}</div>
                              </div>
                              <button
                                onClick={() => { if (have > 0 && !running) setConfirm({ kind: 'augment', id: p.id, name: p.name, lustreless: p.lustreless, count: Math.min(need, have), from: rank, to: target, bag: p.bag, slot: p.slot }); }}
                                disabled={conn == null || !conciergeNear || have <= 0 || running}
                                title={!conciergeNear ? 'Go to a Unity NPC' : have <= 0 ? `No ${LUSTRELESS_NAME[p.lustreless]} available` : running ? 'An augment is already running' : undefined}
                                className="le-tap shrink-0 px-3 py-1.5 text-[12px] font-bold rounded-md bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                              >
                                Augment
                              </button>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {confirm && (
        <Modal onClose={() => setConfirm(null)} panelClass="w-[min(94vw,420px)] p-4 flex flex-col gap-4">
          {(close) => (
            <>
              <div className="text-[13px] text-fg-2 leading-relaxed">
                {confirm.kind === 'open' ? (
                  <>Open <span className="font-semibold text-fg">{confirm.name}</span> for augmenting? This trades the piece plus <span className="font-bold text-amber-300">1 {LUSTRELESS_NAME[confirm.lustreless]}</span> and <span className="font-bold text-amber-300 tabular-nums">30,000</span> <span className="font-bold text-amber-300">Unity Accolades</span>, taking it to <span className="font-bold text-emerald-300">R1</span>.</>
                ) : (
                  <>Use <span className="font-bold text-amber-300 tabular-nums">{confirm.count}</span> <span className="font-bold text-amber-300">{LUSTRELESS_NAME[confirm.lustreless]}{confirm.count === 1 ? '' : 's'}</span> to augment <span className="font-semibold text-fg">{confirm.name}</span> from <span className="font-bold text-sky-300">R{confirm.from}</span> to <span className="font-bold text-emerald-300">R{confirm.to}</span>?</>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => {
                    if (conn != null) {
                      if (confirm.kind === 'open') unityOpen(conn, { id: confirm.id, lus: LUSTRELESS_ID[confirm.lustreless], bag: confirm.bag, slot: confirm.slot });
                      else unityReinforce(conn, { id: confirm.id, lus: LUSTRELESS_ID[confirm.lustreless], count: confirm.count, target: confirm.to, bag: confirm.bag, slot: confirm.slot });
                    }
                    setConfirm(null);
                  }}
                  className="le-tap w-full px-3 py-2.5 text-[13px] font-bold rounded-md bg-emerald-500 text-white hover:bg-emerald-400 transition-colors"
                >
                  Yes, Yes, Yes!
                </button>
                <button
                  onClick={close}
                  className="le-tap w-full px-3 py-2.5 text-[13px] font-bold rounded-md bg-field border border-line text-fg-2 hover:text-fg hover:border-line-2 transition-colors"
                >
                  No, No, No...
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
