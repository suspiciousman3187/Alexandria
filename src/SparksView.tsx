import { useEffect, useMemo, useRef, useState } from 'react';
import { useKnownCharacters, currencyConvert, currencyConvertOn, currencyFarmStop, bulkConvertStop, broadcastCurrency, requestCurrency, type KnownChar, type ConvertProgress } from './bridge';
import { useShopSell, setShopSell } from './shop';
import { useSettings } from './settings';
import { useStickyChar } from './sticky';
import { CharacterSelect, Group, Row } from './ui';
import { useAnon } from './anonymize';
import { OpCard } from './OpCard';

const SPARKS_COST = 2755;
const POWDER_COST = 10;
const ACHERON_NAME = 'Acheron Shield';
const POWDER_NAME = 'Prize Powder';

const fmt = (v: number) => v.toLocaleString();

function balanceOf(c: KnownChar | undefined, name: string): number | null {
  const e = c?.cur?.list.find((x) => x.n === name);
  return e ? e.v : null;
}

function eligibleShops(c: KnownChar): { sparks: boolean; unity: boolean } {
  return {
    sparks: !!c.vendorNear?.sparks && Math.floor((balanceOf(c, 'Sparks of Eminence') ?? 0) / SPARKS_COST) > 0,
    unity: !!c.vendorNear?.unity && Math.floor((balanceOf(c, 'Unity Accolades') ?? 0) / POWDER_COST) > 0,
  };
}

function phaseLabel(p: string) {
  return p === 'selling' ? 'Selling' : p === 'done' ? 'Done' : p === 'stopped' ? 'Stopped' : 'Buying';
}

function ConvertBar({ conv, label }: { conv: ConvertProgress; label?: string }) {
  const pct = conv.total > 0 ? Math.min(100, Math.round((conv.bought / conv.total) * 100)) : 0;
  const done = conv.phase === 'done';
  return (
    <div className="px-3.5 py-2.5 border-t border-line">
      <OpCard state={done ? 'ok' : 'active'} title={label ?? phaseLabel(conv.phase)} count={`${fmt(conv.bought)} / ${fmt(conv.total)}`} pct={pct} />
    </div>
  );
}

function NpcPill({ kind, near }: { kind: 'Sparks' | 'Unity'; near?: boolean }) {
  const state = near == null ? 'unknown' : near ? 'near' : 'far';
  const cls = state === 'near' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
    : state === 'far' ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
    : 'bg-field text-fg-4 border-line';
  const dot = state === 'near' ? 'bg-emerald-400' : state === 'far' ? 'bg-amber-400' : 'bg-fg-4';
  const label = state === 'near' ? `Near ${kind} NPC` : state === 'far' ? `No ${kind} NPC` : `Locating ${kind} NPC…`;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />{label}
    </span>
  );
}

function FleetNpcPill({ kind, near, total }: { kind: 'Sparks' | 'Unity'; near: number; total: number }) {
  const ok = near > 0;
  const cls = ok ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-amber-500/15 text-amber-300 border-amber-500/30';
  const dot = ok ? 'bg-emerald-400' : 'bg-amber-400';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />{near}/{total} near {kind}
    </span>
  );
}

function CompactBar({ conv }: { conv: ConvertProgress }) {
  const pct = conv.total > 0 ? Math.min(100, Math.round((conv.bought / conv.total) * 100)) : 0;
  const done = conv.phase === 'done';
  const item = conv.shop === 'sparks' ? 'Acheron Shield' : conv.shop === 'unity' ? 'Prize Powder' : '';
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] mb-1">
        <span className={`font-semibold ${done ? 'text-emerald-300' : 'text-accent'}`}>{phaseLabel(conv.phase)}{item ? ` · ${item}` : ''}</span>
        <span className="tabular-nums text-fg-4">{fmt(conv.bought)} / {fmt(conv.total)}</span>
      </div>
      <div className="h-1 rounded-full bg-field overflow-hidden">
        <div className={`h-full rounded-full transition-[width] duration-300 ease-out ${done ? 'bg-emerald-400' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function BulkCharRow({ c }: { c: KnownChar }) {
  const anon = useAnon();
  const cv = c.convert;
  const sparks = balanceOf(c, 'Sparks of Eminence') ?? 0;
  const acc = balanceOf(c, 'Unity Accolades') ?? 0;
  const working = cv && (cv.active || cv.phase === 'done');
  const inRange = !!c.vendorNear?.sparks || !!c.vendorNear?.unity;
  return (
    <div className={`px-3.5 py-2 border-t border-line flex items-center gap-3 ${!working && !inRange ? 'opacity-50' : ''}`}>
      <div className="w-28 shrink-0 min-w-0">
        <div className="text-[12px] font-semibold text-fg-2 truncate">{anon(c.name)}</div>
        <div className="flex items-center gap-1 mt-0.5">
          <span className={`w-1.5 h-1.5 rounded-full ${c.vendorNear?.sparks ? 'bg-emerald-400' : 'bg-fg-4'}`} title="Sparks NPC" />
          <span className={`w-1.5 h-1.5 rounded-full ${c.vendorNear?.unity ? 'bg-emerald-400' : 'bg-fg-4'}`} title="Unity NPC" />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        {working ? (
          <CompactBar conv={cv!} />
        ) : !inRange ? (
          <div className="text-[11px] text-amber-300/70">Out of range · will skip</div>
        ) : (
          <div className="text-[11px] text-fg-4 tabular-nums">{sparks > 0 || acc > 0 ? `${fmt(sparks)} Sparks · ${fmt(acc)} Accolades` : 'nothing to convert'}</div>
        )}
      </div>
    </div>
  );
}

export default function SparksView() {
  const known = useKnownCharacters();
  const sell = useShopSell();
  const exp = useSettings().experimentalFeatures;
  const online = useMemo(() => known.filter((k) => k.online && k.conn != null), [known]);
  const [name, setName] = useStickyChar();
  const active = online.find((k) => k.name === name) ?? online[0];
  const conn = active?.conn ?? null;
  const sparks = balanceOf(active, 'Sparks of Eminence');
  const accolades = balanceOf(active, 'Unity Accolades');
  const acheron = sparks != null ? Math.floor(sparks / SPARKS_COST) : 0;
  const powder = accolades != null ? Math.floor(accolades / POWDER_COST) : 0;
  const vendorNear = active?.vendorNear;
  const conv = active?.convert;
  const showConv = (shop: 'sparks' | 'unity') => conv && conv.shop === shop && (conv.active || conv.phase === 'done') ? conv : null;
  const bulkEligible = useMemo(() => online.filter((c) => {
    if (c.conn == null) return false;
    const e = eligibleShops(c);
    return e.sparks || e.unity;
  }), [online]);
  const nearSparks = useMemo(() => online.filter((c) => c.vendorNear?.sparks).length, [online]);
  const nearUnity = useMemo(() => online.filter((c) => c.vendorNear?.unity).length, [online]);

  useEffect(() => { void broadcastCurrency(); }, []);
  useEffect(() => { if (conn != null) requestCurrency(conn); }, [conn]);

  const seedSell = (...names: string[]) => {
    const missing = names.filter((n) => !sell.items.some((x) => x.toLowerCase() === n.toLowerCase()));
    if (missing.length) setShopSell({ ...sell, items: [...sell.items, ...missing] });
  };
  const convert = (shop: 'sparks' | 'unity', sellName: string) => {
    if (conn == null) return;
    seedSell(sellName);
    currencyConvert(conn, shop);
  };
  const stop = () => { if (conn != null) currencyFarmStop(conn); };
  const bulkStart = () => {
    seedSell(ACHERON_NAME, POWDER_NAME);
    for (const c of online) {
      if (c.conn == null) continue;
      const e = eligibleShops(c);
      if (e.sparks && e.unity) currencyConvertOn(c.conn);
      else if (e.sparks) currencyConvertOn(c.conn, 'sparks');
      else if (e.unity) currencyConvertOn(c.conn, 'unity');
    }
  };
  const bulkStop = () => { void bulkConvertStop(); };

  if (online.length === 0) {
    return (
      <div className="h-full grid place-items-center">
        <div className="text-center max-w-sm">
          <div className="text-[15px] font-bold text-fg mb-1">No Connected Characters</div>
          <div className="text-[12px] text-fg-4 leading-relaxed">Converting Sparks and Accolades to gil acts on a live character. Load the Alexandria addon in-game.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-4 pt-4 pb-3 border-b border-line flex items-center gap-2">
        <div className="flex-1 min-w-0"><CharacterSelect value={active?.name ?? ''} onChange={setName} chars={online} /></div>
        <button onClick={() => void broadcastCurrency()} className="le-tap shrink-0 px-3 py-1.5 text-[11px] font-semibold rounded-md border border-line bg-surface text-fg-3 hover:text-fg transition-colors">Refresh</button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 max-w-2xl w-full mx-auto flex flex-col gap-4">
        {exp && online.length > 1 && (
          <Group title="Bulk Convert" right={
            <div className="flex items-center gap-1.5">
              <FleetNpcPill kind="Sparks" near={nearSparks} total={online.length} />
              <FleetNpcPill kind="Unity" near={nearUnity} total={online.length} />
            </div>
          }>
            <Row label="Sparks & Unity Accolades → Gil">
              <div className="flex items-center gap-2">
                <button onClick={bulkStart} disabled={bulkEligible.length === 0} className="le-tap shrink-0 px-4 py-1.5 text-[12px] font-bold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors">Convert {bulkEligible.length || 'All'}</button>
                <button onClick={bulkStop} className="le-tap shrink-0 px-3 py-1.5 text-[11px] font-semibold rounded-md border border-line bg-surface text-fg-3 hover:text-fg transition-colors">Stop All</button>
              </div>
            </Row>
            {online.map((c) => <BulkCharRow key={c.name} c={c} />)}
          </Group>
        )}

        <Group title="Convert Sparks" right={<NpcPill kind="Sparks" near={vendorNear?.sparks} />}>
          <Row label="Sparks of Eminence">
            <span className="text-[12px] tabular-nums text-fg-2">
              {sparks != null ? fmt(sparks) : '—'}<span className="text-fg-4"> · </span>
              <span className={acheron > 0 ? 'text-accent font-semibold' : 'text-fg-4'}>{acheron > 0 ? `${fmt(acheron)} shields` : 'none'}</span>
            </span>
          </Row>
          <Row label="Convert Sparks → Gil">
            <div className="flex items-center gap-2">
              <button onClick={() => convert('sparks', ACHERON_NAME)} disabled={conn == null || vendorNear?.sparks === false} className="le-tap shrink-0 px-4 py-1.5 text-[12px] font-bold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors">Start</button>
              <button onClick={stop} disabled={conn == null} className="le-tap shrink-0 px-3 py-1.5 text-[11px] font-semibold rounded-md border border-line bg-surface text-fg-3 hover:text-fg disabled:opacity-40 transition-colors">Stop</button>
            </div>
          </Row>
          {showConv('sparks') && <ConvertBar conv={showConv('sparks')!} />}
        </Group>

        <Group title="Convert Unity Accolades" right={<NpcPill kind="Unity" near={vendorNear?.unity} />}>
          <Row label="Unity Accolades">
            <span className="text-[12px] tabular-nums text-fg-2">
              {accolades != null ? fmt(accolades) : '—'}<span className="text-fg-4"> · </span>
              <span className={powder > 0 ? 'text-accent font-semibold' : 'text-fg-4'}>{powder > 0 ? `${fmt(powder)} powder` : 'none'}</span>
            </span>
          </Row>
          <Row label="Convert Accolades → Gil">
            <div className="flex items-center gap-2">
              <button onClick={() => convert('unity', POWDER_NAME)} disabled={conn == null || vendorNear?.unity === false} className="le-tap shrink-0 px-4 py-1.5 text-[12px] font-bold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors">Start</button>
              <button onClick={stop} disabled={conn == null} className="le-tap shrink-0 px-3 py-1.5 text-[11px] font-semibold rounded-md border border-line bg-surface text-fg-3 hover:text-fg disabled:opacity-40 transition-colors">Stop</button>
            </div>
          </Row>
          {showConv('unity') && <ConvertBar conv={showConv('unity')!} />}
        </Group>

      </div>
    </div>
  );
}
