import { Fragment, useMemo, useState } from 'react';
import { IconInner } from '../atlasIcon';
import { Select } from '../ui';
import { SLOT_ORDER, SLOT_LABEL, type SlotKey } from './slotLayout';
import { type GearEntry } from './gearsetParser';
import type { NameResolver } from './gearsetValidate';
import {
  aggregateSet, STAT_GROUPS, WEAPON_KEYS, statLabel, fmtStat, isPct, isGood, capInfo, withTrueDamageTaken,
  type StatMods,
} from './gearsetStats';

// Operand = anything the user can put on either side of a comparison: a file set (slots pre-resolved by the
// caller) or a scratch set. The caller supplies the effective per-slot gear so compare stays source-agnostic.
export type CompareOperand = { key: string; label: string; slots: Partial<Record<SlotKey, GearEntry>>; scratch?: boolean };

const CAT_COLOR: Record<string, string> = {
  Attributes: 'var(--gl-gold)', 'Offensive Stats': '#ef9aa0', 'Defensive Stats': '#8fc7f0',
  Pet: '#a985e0', Skills: '#5f9fd7', 'Utility Stats & Other': '#5fc7ad', Weapon: '#c7b25e',
};
const CAT_SHORT: Record<string, string> = { 'Offensive Stats': 'Offense', 'Defensive Stats': 'Defense', 'Utility Stats & Other': 'Utility' };

type ResolvedSlots = Partial<Record<SlotKey, GearEntry>>;
const sigOf = (e?: GearEntry) => e ? (e.kind === 'item' ? `${e.name}|${(e.augments ?? []).join(',')}` : `dyn:${e.raw}`) : '';
const nameOf = (e?: GearEntry) => e ? (e.kind === 'item' ? e.name : e.raw) : '';

export function GearsetCompare({ operands, resolve, iconSet, assets, job, initialA }: {
  operands: CompareOperand[];
  resolve: NameResolver;
  iconSet: Set<number>;
  assets?: string;
  job: string;
  initialA?: string;
}) {
  const [tab, setTab] = useState<'two' | 'all'>('two');
  const [aKey, setAKey] = useState(initialA && operands.some((o) => o.key === initialA) ? initialA : operands[0]?.key ?? '');
  const [bKey, setBKey] = useState(operands[1]?.key ?? operands[0]?.key ?? '');
  const opMap = useMemo(() => new Map(operands.map((o) => [o.key, o])), [operands]);

  const slotsOf = (key: string): ResolvedSlots => opMap.get(key)?.slots ?? {};
  const statsOf = (key: string): StatMods => {
    const slots = slotsOf(key);
    const wrapped: Partial<Record<SlotKey, { entry: GearEntry }>> = {};
    for (const slot of Object.keys(slots) as SlotKey[]) wrapped[slot] = { entry: slots[slot]! };
    return withTrueDamageTaken(aggregateSet(wrapped, resolve));
  };

  const aSlots = useMemo(() => slotsOf(aKey), [aKey, opMap]);
  const bSlots = useMemo(() => slotsOf(bKey), [bKey, opMap]);
  const aStats = useMemo(() => statsOf(aKey), [aKey, opMap, resolve]);
  const bStats = useMemo(() => statsOf(bKey), [bKey, opMap, resolve]);
  const diffSlots = useMemo(() => new Set(SLOT_ORDER.filter((s) => sigOf(aSlots[s]) !== sigOf(bSlots[s]))), [aSlots, bSlots]);

  const aLabel = operands.find((o) => o.key === aKey)?.label ?? aKey;
  const bLabel = operands.find((o) => o.key === bKey)?.label ?? bKey;

  const keys = useMemo(() => operands.map((o) => o.key), [operands]);
  const renderOpt = (k: string) => { const o = opMap.get(k); return <span style={o?.scratch ? { color: 'var(--gl-aug)' } : undefined}>{o?.label ?? k}</span>; };
  const renderVal = (color: string) => (k: string) => <span className="font-semibold truncate" style={{ color }}>{opMap.get(k)?.label ?? k}</span>;

  const MiniGrid = ({ slots }: { slots: ResolvedSlots }) => (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(4,minmax(0,1fr))' }}>
      {SLOT_ORDER.map((slot) => {
        const e = slots[slot];
        const nm = nameOf(e);
        const id = e && e.kind === 'item' ? resolve(e.name)?.id : undefined;
        const diff = diffSlots.has(slot);
        return (
          <div key={slot} className={`rounded-lg p-1.5 flex flex-col items-center gap-1 text-center min-h-[72px] ${diff ? '' : 'opacity-85'}`}
            style={{ background: diff ? 'rgba(217,140,74,.1)' : 'var(--color-field)', border: `1px solid ${diff ? 'rgba(217,140,74,.6)' : 'var(--color-line-2)'}`, boxShadow: diff ? 'inset 0 0 0 1px rgba(217,140,74,.35)' : undefined }}>
            <div className="text-[7.5px] font-bold uppercase tracking-wide text-fg-4 leading-none">{SLOT_LABEL[slot]}</div>
            <div className="w-7 h-7 rounded-md bg-field border border-line grid place-items-center overflow-hidden">
              {id && id > 0 ? <IconInner id={id} size={28} name={nm} assets={assets} bmpHas={iconSet.has(id)} />
                : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--gl-gold)" strokeWidth="1.6"><path d="M12 5v14M5 12h14" /></svg>}
            </div>
            <div className="text-[8.5px] leading-[1.1] line-clamp-2" style={{ color: diff ? '#f3cfa0' : 'var(--color-fg-2)' }}>{nm || '—'}</div>
          </div>
        );
      })}
    </div>
  );

  // Stat rows for the A|B|Δ panel: every stat either set carries, grouped.
  const rows = useMemo(() => {
    const out: { cat: string; keys: string[] }[] = [];
    for (const gp of STAT_GROUPS) {
      const keys = gp.keys.filter((k) => (aStats[k] ?? 0) !== 0 || (bStats[k] ?? 0) !== 0);
      if (keys.length) out.push({ cat: gp.title, keys });
    }
    const wk = WEAPON_KEYS.filter((k) => (aStats[k] ?? 0) !== 0 || (bStats[k] ?? 0) !== 0);
    if (wk.length) out.push({ cat: 'Weapon', keys: wk });
    return out;
  }, [aStats, bStats]);

  return (
    <section className="gs-wash min-h-0 flex flex-col overflow-hidden">
      {/* header: operands + sub-tabs */}
      <div className="shrink-0 flex items-center gap-2.5 px-4 py-2.5 border-b border-line flex-wrap">
        <div className="flex flex-col gap-0.5">
          <span className="text-[8px] font-extrabold uppercase tracking-[0.14em]" style={{ color: '#8fc7f0' }}>Set A</span>
          <div className="w-[210px]"><Select value={aKey} onChange={setAKey} options={keys} full searchable menuMaxH={320} renderValue={renderVal('#8fc7f0')} renderOption={renderOpt} /></div>
        </div>
        <button onClick={() => { const a = aKey; setAKey(bKey); setBKey(a); }} title="Swap A / B"
          className="le-tap w-8 h-8 mt-3 grid place-items-center rounded-md border border-line bg-field text-fg-3 hover:text-accent transition-colors">⇄</button>
        <div className="flex flex-col gap-0.5">
          <span className="text-[8px] font-extrabold uppercase tracking-[0.14em]" style={{ color: 'var(--gl-aug)' }}>Set B</span>
          <div className="w-[210px]"><Select value={bKey} onChange={setBKey} options={keys} full searchable menuMaxH={320} renderValue={renderVal('var(--gl-aug)')} renderOption={renderOpt} /></div>
        </div>
        <div className="ml-auto flex items-center gap-1 rounded-lg border border-line bg-field p-0.5">
          {(['two', 'all'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className="le-tap px-3 py-1 text-[11px] font-bold rounded-md transition-colors"
              style={tab === t ? { background: 'var(--color-accent)', color: 'var(--color-on-accent)' } : { color: 'var(--color-fg-3)' }}>
              {t === 'two' ? '2-Way' : 'Compare All'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'two' ? (
        <div className="flex-1 min-h-0 overflow-y-auto grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 360px' }}>
          <div className="p-4 grid gap-4" style={{ gridTemplateColumns: '1fr 1fr', alignContent: 'start' }}>
            <div>
              <div className="flex items-center gap-2 mb-2 text-[12px] font-bold" style={{ color: '#8fc7f0' }}>{aLabel}<span className="ml-auto text-[9px] font-semibold text-fg-4">{diffSlots.size} differ</span></div>
              <MiniGrid slots={aSlots} />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2 text-[12px] font-bold" style={{ color: 'var(--gl-aug)' }}>{bLabel}<span className="ml-auto text-[9px] font-semibold text-fg-4">{diffSlots.size} differ</span></div>
              <MiniGrid slots={bSlots} />
            </div>
          </div>
          {/* A | B | Δ stat panel */}
          <div className="border-l border-line p-3 overflow-y-auto">
            <div className="grid text-[8.5px] font-extrabold uppercase tracking-[0.1em] text-fg-4 pb-1 mb-1 border-b border-line-2" style={{ gridTemplateColumns: '1fr 56px 56px 60px' }}>
              <span>Stat</span><span className="text-right">A</span><span className="text-right">B</span><span className="text-right">Δ</span>
            </div>
            {rows.length === 0 && <div className="py-8 text-center text-[11px] text-fg-4">No stat data.</div>}
            {rows.map(({ cat, keys }) => (
              <div key={cat} className="mt-2.5 first:mt-1">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-[9px] font-extrabold uppercase tracking-[0.12em]" style={{ color: CAT_COLOR[cat] }}>{CAT_SHORT[cat] ?? cat}</span>
                  <span className="flex-1 h-px" style={{ background: 'var(--color-line-2)' }} />
                </div>
                {keys.map((k) => {
                  const a = aStats[k] ?? 0, b = bStats[k] ?? 0, d = b - a;
                  const dc = d === 0 ? 'var(--color-fg-4)' : isGood(k, d) ? 'var(--gl-up)' : 'var(--gl-down)';
                  const cap = capInfo(k, b, job);
                  const bcol = cap?.over ? 'var(--gl-down)' : cap?.atCap ? 'var(--gl-up)' : 'var(--color-fg)';
                  return (
                    <div key={k} className="grid items-baseline gap-1.5 py-[1px] text-[10.5px]" style={{ gridTemplateColumns: '1fr 56px 56px 60px' }}>
                      <span className="text-fg-3 truncate" title={statLabel(k)}>{statLabel(k)}</span>
                      <span className="text-right font-mono tabular-nums text-fg-4">{fmtStat(k, a)}</span>
                      <span className="text-right font-mono tabular-nums font-bold" style={{ color: bcol }}>{fmtStat(k, b)}{cap ? <span className="text-fg-4 font-normal">/{Math.abs(cap.cap)}{isPct(k) ? '%' : ''}</span> : null}</span>
                      <span className="text-right font-mono tabular-nums font-bold" style={{ color: dc }}>{d === 0 ? '·' : (d > 0 ? '+' : '') + d + (isPct(k) ? '%' : '')}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <CompareAll operands={operands} statsOf={statsOf} job={job} />
      )}
    </section>
  );
}

// N-way table: rows = stats, columns = sets, best-in-row highlighted.
function CompareAll({ operands, statsOf, job }: { operands: CompareOperand[]; statsOf: (k: string) => StatMods; job: string }) {
  const stats = useMemo(() => operands.map((o) => ({ ...o, mods: statsOf(o.key) })), [operands, statsOf]);
  const rows = useMemo(() => {
    const out: { cat: string; keys: string[] }[] = [];
    const present = (k: string) => stats.some((s) => (s.mods[k] ?? 0) !== 0);
    for (const gp of STAT_GROUPS) { const keys = gp.keys.filter(present); if (keys.length) out.push({ cat: gp.title, keys }); }
    const wk = WEAPON_KEYS.filter(present); if (wk.length) out.push({ cat: 'Weapon', keys: wk });
    return out;
  }, [stats]);
  const bestIdx = (k: string) => {
    let bi = -1, bv = 0;
    stats.forEach((s, i) => { const v = s.mods[k] ?? 0; if (v === 0) return; if (bi < 0 || (isGood(k, v - bv))) { bi = i; bv = v; } });
    return bi;
  };
  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <table className="text-[11.5px]" style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-20 text-left px-3 py-1.5 font-bold text-fg-2" style={{ background: 'var(--color-bg)', borderBottom: '1px solid var(--color-line)' }}>Stat</th>
            {operands.map((o) => (
              <th key={o.key} className="sticky top-0 z-10 text-right px-3 py-1.5 font-bold whitespace-nowrap text-fg-2" style={{ background: 'var(--color-bg)', borderBottom: '1px solid var(--color-line)' }}>{o.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ cat, keys }) => (
            <Fragment key={cat}>
              <tr><td colSpan={operands.length + 1} className="px-3 py-1 text-[9px] font-extrabold uppercase tracking-[0.12em]" style={{ background: 'var(--color-field)', color: CAT_COLOR[cat] }}>{CAT_SHORT[cat] ?? cat}</td></tr>
              {keys.map((k) => { const bi = bestIdx(k); return (
                <tr key={k} className="hover:bg-surface-hover">
                  <td className="sticky left-0 text-left px-3 py-1 text-fg-3 whitespace-nowrap" style={{ background: 'var(--color-panel, rgba(22,14,8,.9))', borderBottom: '1px solid var(--color-line-2)' }}>{statLabel(k)}</td>
                  {stats.map((s, i) => { const v = s.mods[k] ?? 0; return (
                    <td key={s.key} className="text-right px-3 py-1 font-mono tabular-nums" style={{ borderBottom: '1px solid var(--color-line-2)', color: i === bi ? 'var(--gl-up)' : 'var(--color-fg)', fontWeight: i === bi ? 700 : 400, background: i === bi ? 'rgba(127,214,138,.12)' : undefined }}>
                      {v === 0 ? <span className="text-fg-4">·</span> : fmtStat(k, v)}
                    </td>
                  ); })}
                </tr>
              ); })}
            </Fragment>
          ))}
        </tbody>
      </table>
      {!rows.length && <div className="py-10 text-center text-[12px] text-fg-4">No comparable stats.</div>}
      <div className="px-3 py-2 text-[10px] text-fg-4">Best value in each row is highlighted. Caps are not applied here (totals only). Job: {job || '-'}.</div>
    </div>
  );
}
