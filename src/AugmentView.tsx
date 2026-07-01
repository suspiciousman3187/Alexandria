import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useKnownCharacters, useAvailableIcons, useItemDescription, augCape, augCapeSeq, augGear, augStop, augKeep, augReroll, augStopAll, type InvBag, type AugState, type KnownChar, type CapeSeqStep } from './bridge';
import { useItemNames } from './itemNames';
import { IconInner } from './atlasIcon';
import { Group, Row, RowStacked, Segmented, Select, Slider, CharacterSelect, Stepper, SectionTabs, SearchInput } from './ui';
import { OpGlyph } from './OpCard';
import { Crossfade, Modal } from './overlay';
import { useStickyChar, useStickyPersisted } from './sticky';
import { JOBS, JOB_TO_CAPE, MATERIALS, AUG_PATHS, CAPE_MAX, STYLES, AUG_STATS, TRADE_TYPES, VIEW_TRADE_TYPES, augPathLabel } from './augData';
import { gearInstancesFor, augKey, readGearCfg, cfgReady, wantedSummary, buildGearArg, resolveSel } from './augConfig';
import { useNowTick } from './reltime';
import { useSettings } from './settings';
import { bagColor } from './bagColors';
import { useAnon } from './anonymize';

function GearRow({ name, id, assets, hasBmp, showDesc, loc }: { name: string; id?: number; assets?: string; hasBmp: boolean; showDesc?: boolean; loc?: ReactNode }) {
  const desc = useItemDescription(id ?? -1);
  const multiline = (showDesc && desc) || loc;
  return (
    <div className={`flex gap-2.5 min-w-0 ${multiline ? 'items-start' : 'items-center'}`}>
      <div className="relative shrink-0 w-8 h-8 rounded bg-field grid place-items-center overflow-hidden">
        <IconInner id={id ?? 0} size={32} name={name} assets={assets} bmpHas={hasBmp} />
      </div>
      <div className="min-w-0">
        <div className="text-[12px] font-semibold text-fg-2 leading-tight truncate">{name}</div>
        {loc && <div className="text-[10px] font-semibold text-fg-4 leading-snug mt-0.5 truncate">{loc}</div>}
        {showDesc && desc && <div className="text-[10px] text-fg-4 leading-snug mt-0.5 whitespace-pre-wrap">{desc}</div>}
      </div>
    </div>
  );
}

function useNameResolver() {
  const icons = useAvailableIcons();
  const db = useItemNames();
  const nameId = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of db) { const k = it.n.toLowerCase(); if (!m.has(k)) m.set(k, it.id); }
    return m;
  }, [db]);
  return useMemo(() => ({
    idOf: (n: string) => nameId.get(n.toLowerCase()),
    has: (id?: number) => id != null && icons.has(id),
  }), [nameId, icons]);
}

type Resolver = { idOf: (n: string) => number | undefined; has: (id?: number) => boolean };

function materialLocations(inv: InvBag[] | undefined, name: string): { total: number; spots: { bag: string; bagId: number; count: number }[] } {
  const spots: { bag: string; bagId: number; count: number }[] = [];
  let total = 0;
  const lc = name.toLowerCase();
  for (const bag of inv ?? []) {
    let c = 0;
    for (const it of bag.items) if (it.n.toLowerCase() === lc) c += it.c;
    if (c > 0) { spots.push({ bag: bag.b, bagId: bag.id, count: c }); total += c; }
  }
  spots.sort((a, b) => b.count - a.count);
  return { total, spots };
}

function MaterialStock({ inv, names, res, assets, selected, onSelect }: { inv?: InvBag[]; names: string[]; res: Resolver; assets?: string; selected?: string; onSelect?: (name: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      {names.map((n) => {
        const { total, spots } = materialLocations(inv, n);
        const id = res.idOf(n);
        const isSel = !!selected && n.toLowerCase() === selected.toLowerCase();
        const cls = `flex items-center gap-2.5 rounded-md px-2 py-1.5 border text-left transition-colors ${isSel ? 'border-accent/40 bg-accent/10' : 'border-line bg-field/40'} ${onSelect ? 'hover:border-accent/40 cursor-pointer' : ''}`;
        const inner = (
          <>
            <div className="shrink-0 w-7 h-7 rounded bg-field grid place-items-center overflow-hidden"><IconInner id={id ?? 0} size={28} name={n} assets={assets} bmpHas={res.has(id)} /></div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold text-fg-2 truncate">{n}</span>
                <span className={`ml-auto shrink-0 text-[12px] font-bold tabular-nums ${total > 0 ? 'text-emerald-300' : 'text-fg-4'}`}>{total}</span>
              </div>
              <div className="text-[10px] text-fg-4 leading-snug truncate">{total > 0 ? spots.map((s, i) => <span key={s.bag}>{i > 0 && <span className="text-fg-5"> · </span>}<span className={`font-medium ${bagColor(s.bagId).text}`}>{s.bag}</span> {s.count}</span>) : 'none in bags'}</div>
            </div>
          </>
        );
        return onSelect
          ? <button key={n} type="button" onClick={() => onSelect(n)} className={cls} aria-pressed={isSel}>{inner}</button>
          : <div key={n} className={cls}>{inner}</div>;
      })}
    </div>
  );
}

function CapeRow({ name, augs, id, assets, hasBmp }: { name: string; augs: string[]; id?: number; assets?: string; hasBmp: boolean }) {
  const shown = (augs ?? []).filter((a) => a && a.toLowerCase() !== 'none');
  return (
    <div className="flex items-start gap-2.5">
      <div className="relative shrink-0 w-8 h-8 rounded bg-field grid place-items-center overflow-hidden mt-0.5">
        <IconInner id={id ?? 0} size={32} name={name} assets={assets} bmpHas={hasBmp} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-semibold text-fg-2 leading-tight truncate">{name}</div>
        {shown.length > 0
          ? <div className="mt-0.5 flex flex-col gap-0.5">{shown.map((a, i) => <div key={i} className="text-[10px] leading-snug truncate"><AugText text={a} /></div>)}</div>
          : <div className="mt-0.5 text-[10px] text-fg-4 italic">No augments</div>}
      </div>
    </div>
  );
}

function StatusCard({ status, attempts, total, active, results, manual, header, bar }: { status?: string; attempts?: number; total?: number; active?: boolean; results?: Record<string, number>; manual?: boolean; header?: ReactNode; bar?: boolean }) {
  const entries = results ? Object.entries(results) : [];
  const pct = total && total > 0 ? Math.min(100, Math.round(((attempts ?? 0) / total) * 100)) : 0;
  return (
    <div className="rounded-xl bg-surface border border-line p-3 mb-3">
      {header && <div className="mb-2.5 pb-2.5 border-b border-line">{header}</div>}
      <div className={`flex items-center justify-between ${bar ? 'mb-2' : 'mb-2'}`}>
        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-fg">
          <OpGlyph state={active ? 'active' : 'ok'} className="w-3.5 h-3.5" />
          {status || (active ? 'Working' : 'Idle')}
        </span>
        {!manual && total != null && total > 0
          ? <span className="text-[11px] tabular-nums text-fg-4">{attempts ?? 0} / {total}</span>
          : (attempts != null && attempts > 0 ? <span className="text-[11px] tabular-nums text-fg-4">roll {attempts}</span> : null)}
      </div>
      {bar ? (
        <div className="h-1.5 rounded-full bg-field overflow-hidden">
          <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${total && total > 0 ? pct : 0}%` }} />
        </div>
      ) : (
        <div className="rounded-lg bg-field/50 border border-line px-2.5 py-2">
          {entries.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {entries.map(([k, v]) => (
                <span key={k} className="inline-flex items-baseline gap-1 text-[12px] px-2 py-1 rounded-md bg-surface border border-line">
                  <span className="text-fg-3">{k}</span>
                  <span className={`font-bold tabular-nums ${v < 0 ? 'text-red-300' : 'text-emerald-300'}`}>{v >= 0 ? `+${v}` : v}</span>
                </span>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-fg-4 italic text-center py-1">{active ? 'waiting for first roll…' : 'no augments'}</div>
          )}
        </div>
      )}
    </div>
  );
}

const VIEW_AUG_MODE: Record<string, string> = { ambuscade: 'Ambuscade', skirmish: 'Skirmish', reive: 'Cape', geasfete: 'Geas Fete' };
function AugProgress({ aug, assets, viewMode, onKeep, onReroll, onStop }: { aug?: AugState | null; assets?: string; viewMode?: string; onKeep?: () => void; onReroll?: () => void; onStop?: () => void }) {
  const res = useNameResolver();
  const active = !!aug?.active;
  const matches = !viewMode || aug?.mode === viewMode;
  const hasCard = matches && !!(aug && (aug.active || aug.status));
  const [dismissed, setDismissed] = useState(() => !active);
  const prevActive = useRef(active);
  const itemId = aug?.id ?? (aug?.item ? res.idOf(aug.item) : undefined);
  const isAmb = aug?.mode === 'Ambuscade';
  const header = !isAmb && aug?.item ? <GearRow name={aug.item} id={itemId} assets={assets} hasBmp={res.has(itemId)} showDesc /> : null;

  useEffect(() => { if (active) setDismissed(false); }, [active]);

  useEffect(() => {
    const wasActive = prevActive.current;
    prevActive.current = active;
    if (wasActive && !active && hasCard) {
      const t = setTimeout(() => setDismissed(true), 4500);
      return () => clearTimeout(t);
    }
  }, [active, hasCard]);

  const visible = hasCard && !dismissed;
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.35 }}
          className="sticky top-0 z-20 -mx-4 -mt-4 px-4 pt-4 pb-1 bg-bg/95 backdrop-blur-sm"
        >
          <StatusCard status={aug?.status} attempts={aug?.attempts} total={aug?.total} active={aug?.active} results={aug?.results} manual={aug?.manual} header={header} bar={isAmb} />
          {aug?.awaitDecision && onKeep && onReroll ? (
            <div className="flex gap-2 mb-3">
              <button onClick={onKeep} className="flex-1 px-3 py-2 text-[12px] font-bold rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/25 transition-colors">Keep</button>
              <button onClick={onReroll} className="flex-1 px-3 py-2 text-[12px] font-bold rounded-md bg-accent/15 text-accent border border-accent/40 hover:bg-accent/25 transition-colors">Reroll</button>
              {onStop && (
                <button onClick={onStop} aria-label="Stop" title="Stop" className="shrink-0 grid place-items-center px-2.5 rounded-md bg-red-500/15 text-red-300 border border-red-500/40 hover:bg-red-500/25 transition-colors">
                  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
                </button>
              )}
            </div>
          ) : active && aug?.manual ? (
            <button disabled className="w-full mb-3 px-3 py-2 text-[12px] font-bold rounded-md bg-field border border-line text-fg-4 opacity-60 cursor-default">
              Rolling…
            </button>
          ) : active && onStop ? (
            <button onClick={onStop} className="w-full mb-3 px-3 py-2 text-[12px] font-bold rounded-md bg-red-500/15 text-red-300 border border-red-500/40 hover:bg-red-500/25 transition-colors">
              Stop Now
            </button>
          ) : null}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const AUG_NPC: Record<string, { name: string; zone: number }> = {
  Ambuscade: { name: 'Gorpa-Masorpa', zone: 249 },
  Skirmish: { name: 'Divainy-Gamainy', zone: 256 },
  Cape: { name: 'Detrovio', zone: 256 },
  'Geas Fete': { name: 'Oseem', zone: 252 },
};
function augLocOk(key: string, zone: number | undefined, fixedNear: string[] | undefined, experimental: boolean): boolean {
  const npc = AUG_NPC[key];
  if (!npc) return false;
  return experimental ? zone === npc.zone : !!fixedNear?.includes(npc.name);
}
function AmbuscadePanel({ conn, assets, inv, zone, fixedNear, experimental }: { conn: number; assets?: string; inv?: InvBag[]; zone?: number; fixedNear?: string[]; experimental: boolean }) {
  const inZone = augLocOk('Ambuscade', zone, fixedNear, experimental);
  const res = useNameResolver();
  const capeToJob = useMemo(() => {
    const m = new Map<string, string>();
    for (const j of JOBS) { const cape = JOB_TO_CAPE[j.code]; if (cape) m.set(cape.toLowerCase(), j.code); }
    return m;
  }, []);
  const instances = useMemo(() => {
    const out: Inst[] = [];
    const seen = new Set<string>();
    for (const bag of inv ?? []) for (const it of bag.items) {
      if (!it.n || !capeToJob.has(it.n.toLowerCase())) continue;
      if (seen.has(it.n)) continue;
      seen.add(it.n);
      out.push({ key: it.n, name: it.n, bagId: bag.id, bagName: bag.b, slot: it.s, aug: it.aug ?? [] });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [inv, capeToJob]);

  const [selKey, setSelKey] = useStickyPersisted('aug.amb.sel', '');
  const sel = instances.find((i) => i.key === selKey);
  const job = capeToJob.get((sel?.name ?? (selKey.includes(':') ? '' : selKey)).toLowerCase());

  const [material, setMaterial] = useStickyPersisted<string>('aug.amb.mat', 'Dust');
  const paths = AUG_PATHS[material] ?? [];
  const [pathMap, setPathMap] = useStickyPersisted<Record<string, string>>('aug.amb.pathmap', {});
  const path = paths.includes(pathMap[material]) ? pathMap[material] : (paths[0] ?? '');
  const setPath = (p: string) => setPathMap((m) => ({ ...m, [material]: p }));
  const [repeats, setRepeats] = useStickyPersisted('aug.amb.repeats', 10);
  const [tab, setTab] = useStickyPersisted<'single' | 'multi'>('aug.amb.tab', 'single');

  const max = CAPE_MAX[material] ?? 20;

  return (
    <>
      <Group title="Cape">
        <div className="px-3.5 py-3">
          <EquipList items={instances} selected={sel?.key ?? ''} onSelect={setSelKey} res={res} assets={assets} />
        </div>
      </Group>
      <div className="my-3"><SectionTabs value={tab} onChange={setTab} tabs={[{ id: 'single', label: 'Single' }, { id: 'multi', label: 'Multi' }]} /></div>
      {tab === 'single' ? (
        <>
          <Group title="Material">
            <div className="px-3.5 py-3">
              <MaterialStock inv={inv} names={MATERIALS.map((m) => `Abdhaljs ${m}`)} res={res} assets={assets} selected={`Abdhaljs ${material}`} onSelect={(n) => setMaterial(n.slice('Abdhaljs '.length))} />
            </div>
          </Group>
          {job && (
            <>
              <Group title="Path">
                <Row label="Stat Path"><div className="w-60"><Select value={path} onChange={setPath} options={paths} renderOption={augPathLabel} renderValue={augPathLabel} menuMaxH={320} full /></div></Row>
                <RowStacked label="Repeats" desc={`Trades the material this many times (max ${max} for ${material.toLowerCase()})`}>
                  <Slider value={repeats} min={1} max={max} step={1} onChange={setRepeats} />
                </RowStacked>
              </Group>
              <div className="px-1">
                <button
                  onClick={() => { if (sel) augCape(conn, { job, material: material.toLowerCase(), path, repeats, bag: sel.bagId, slot: sel.slot }); }}
                  disabled={!inZone || !sel}
                  className="w-full px-3 py-2 text-[12px] font-bold rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Start Augment
                </button>
                {!inZone && <div className="mt-1.5 text-[11px] text-amber-300">{experimental ? "Travel to Gorpa-Masorpa's zone to augment." : 'Stand next to Gorpa-Masorpa to augment.'}</div>}
              </div>
            </>
          )}
        </>
      ) : (
        <AmbuscadeMulti conn={conn} sel={sel} job={job} inZone={inZone} inv={inv} assets={assets} res={res} />
      )}
    </>
  );
}

function stepNeed(steps: CapeSeqStep[], material: string): number {
  return steps.filter((s) => s.material === material).reduce((n, s) => n + s.repeats, 0);
}

function AmbuscadeMulti({ conn, sel, job, inZone, inv, assets, res }: { conn: number; sel?: Inst; job?: string; inZone: boolean; inv?: InvBag[]; assets?: string; res: Resolver }) {
  const [steps, setSteps] = useStickyPersisted<CapeSeqStep[]>('aug.amb.steps', []);
  const used = useMemo(() => new Set(steps.map((s) => s.material)), [steps]);
  const avail = useMemo(() => (MATERIALS as readonly string[]).filter((m) => !used.has(m)), [used]);
  const [mat, setMat] = useState<string>(avail[0] ?? 'Thread');
  useEffect(() => { if (avail.length && !avail.includes(mat)) setMat(avail[0]); }, [avail, mat]);
  const paths = AUG_PATHS[mat] ?? [];
  const [pathMap, setPathMap] = useStickyPersisted<Record<string, string>>('aug.amb.multipathmap', {});
  const path = paths.includes(pathMap[mat]) ? pathMap[mat] : (paths[0] ?? '');
  const setPath = (p: string) => setPathMap((m) => ({ ...m, [mat]: p }));
  const max = CAPE_MAX[mat] ?? 20;
  const [reps, setReps] = useState(Math.min(10, max));
  useEffect(() => { setReps((r) => Math.min(Math.max(1, r), max)); }, [max]);
  const [confirming, setConfirming] = useState(false);

  const addStep = () => { if (!mat || !path) return; setSteps((s) => [...s, { material: mat, path, repeats: Math.min(reps, max) }]); };
  const removeStep = (i: number) => setSteps((s) => s.filter((_, idx) => idx !== i));
  const startSeq = () => { if (sel && job) { augCapeSeq(conn, { job, bag: sel.bagId, slot: sel.slot, steps }); setConfirming(false); } };

  const canReview = inZone && !!sel && steps.length > 0;

  return (
    <>
      <Group title="Add Step">
        {avail.length > 0 ? (
          <>
            <Row label="Material"><Segmented value={mat} onChange={setMat} options={avail.map((m) => ({ v: m, label: m }))} /></Row>
            <Row label="Stat Path"><div className="w-60"><Select value={path} onChange={setPath} options={paths} renderOption={augPathLabel} renderValue={augPathLabel} menuMaxH={320} full /></div></Row>
            <RowStacked label="Repeats" desc={`max ${max} for ${mat.toLowerCase()}`}>
              <Slider value={Math.min(reps, max)} min={1} max={max} step={1} onChange={setReps} />
            </RowStacked>
            <div className="px-3.5 pb-3 pt-1">
              <button onClick={addStep} disabled={!path} className="w-full px-3 py-1.5 text-[11px] font-bold rounded-md bg-field border border-line text-fg-2 hover:border-accent/40 disabled:opacity-40 transition-colors">Add Step</button>
            </div>
          </>
        ) : (
          <div className="px-3.5 py-3 text-[11px] text-fg-4">All five materials are in the sequence.</div>
        )}
      </Group>
      <Group title={`Sequence${steps.length ? ` · ${steps.length}` : ''}`}>
        <div className="px-3.5 py-3 flex flex-col gap-1.5">
          {steps.length === 0 ? (
            <div className="text-[11px] text-fg-4">No steps yet. Add one or more above, then review.</div>
          ) : steps.map((s, i) => {
            const have = materialLocations(inv, `Abdhaljs ${s.material}`).total;
            const need = stepNeed(steps, s.material);
            const short = have < need;
            return (
              <div key={i} className="flex items-center gap-2.5 rounded-md border border-line bg-field/40 px-2.5 py-1.5">
                <span className="shrink-0 w-5 text-[11px] font-bold text-fg-4 tabular-nums">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-semibold text-fg-2 truncate">{s.material} → {augPathLabel(s.path)}</div>
                  <div className={`text-[10px] ${short ? 'text-red-300' : 'text-fg-4'}`}>×{s.repeats} · have {have}{short ? ` (need ${need})` : ''}</div>
                </div>
                <button onClick={() => removeStep(i)} aria-label="Remove" className="shrink-0 grid place-items-center w-6 h-6 rounded text-fg-4 hover:text-red-300 hover:bg-red-500/10 transition-colors">
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
                </button>
              </div>
            );
          })}
        </div>
      </Group>
      <div className="px-1">
        <button onClick={() => setConfirming(true)} disabled={!canReview} className="w-full px-3 py-2 text-[12px] font-bold rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
          Review &amp; Augment
        </button>
      </div>
      {confirming && (
        <Modal onClose={() => setConfirming(false)} panelClass="w-[min(94vw,420px)] p-4 gap-3">
          {(close) => (
            <>
              <div className="text-[14px] font-bold text-fg">Confirm Multi Augment</div>
              <div className="text-[11px] text-fg-4 -mt-1">{sel?.name} in {sel?.bagName}</div>
              <div className="flex flex-col gap-1.5 max-h-[44vh] overflow-y-auto">
                {steps.map((s, i) => {
                  const have = materialLocations(inv, `Abdhaljs ${s.material}`).total;
                  const need = stepNeed(steps, s.material);
                  const short = have < need;
                  return (
                    <div key={i} className="flex items-center gap-2.5 rounded-md border border-line bg-field/40 px-2.5 py-1.5">
                      <span className="shrink-0 w-5 text-[11px] font-bold text-fg-4 tabular-nums">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-semibold text-fg-2 truncate">{s.material} → {augPathLabel(s.path)}</div>
                        <div className={`text-[10px] ${short ? 'text-red-300' : 'text-emerald-300'}`}>uses {s.repeats} Abdhaljs {s.material} · have {have}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {steps.some((s) => materialLocations(inv, `Abdhaljs ${s.material}`).total < stepNeed(steps, s.material)) && (
                <div className="text-[11px] text-red-300">You are short on materials for one or more steps. The run will stop when a material runs out.</div>
              )}
              <div className="flex items-center gap-2">
                <button onClick={close} className="flex-1 px-3 py-2 text-[12px] font-bold rounded-md bg-field border border-line text-fg-3 hover:text-fg-2 transition-colors">Cancel</button>
                <button onClick={startSeq} className="flex-1 px-3 py-2 text-[12px] font-bold rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors">Augment {steps.length} Step{steps.length === 1 ? '' : 's'}</button>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}

function AugRow({ idx, stat, val, onStat, onVal }: { idx: number; stat: string; val: number; onStat: (v: string) => void; onVal: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-[11px] font-semibold text-fg-4 w-4 tabular-nums">{idx}</span>
      <div className="flex-1 min-w-0">
        <Select value={stat} onChange={onStat} options={['(any)', ...AUG_STATS]} searchable full />
      </div>
      <Stepper value={val} min={0} max={999} onChange={onVal} title="Minimum value to accept" className="shrink-0" numW="w-11" />
    </div>
  );
}

function AugText({ text }: { text: string }) {
  const parts = text.split(/([+-]?\d+%?)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (/^[+-]?\d+%?$/.test(p)) {
          return <span key={i} className={`font-bold ${p.startsWith('-') ? 'text-red-300' : 'text-emerald-300'}`}>{p}</span>;
        }
        return <span key={i} className="text-fg-2">{p}</span>;
      })}
    </>
  );
}

type Inst = { key: string; name: string; bagId: number; bagName: string; slot: number; aug: string[] };

function EquipList({ items, selected, onSelect, res, assets }: {
  items: Inst[]; selected: string; onSelect: (key: string) => void;
  res: { idOf: (n: string) => number | undefined; has: (id?: number) => boolean };
  assets?: string;
}) {
  const [filter, setFilter] = useState('');
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? items.filter((i) => i.name.toLowerCase().includes(q)) : items;
  }, [items, filter]);
  if (items.length === 0) return <div className="text-[12px] text-fg-4 text-center py-6">None of these are in your bags.</div>;
  return (
    <div className="flex flex-col gap-2.5">
      <SearchInput value={filter} onChange={setFilter} wrap="" placeholder="Filter equipment…"
        className="bg-field border border-line rounded-md px-3 py-1.5 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 transition-colors" />
      {shown.length === 0 ? (
        <div className="text-[12px] text-fg-4 text-center py-6">No matches.</div>
      ) : (
        <div className="rounded-lg border border-line bg-surface overflow-hidden divide-y divide-line max-h-[420px] overflow-y-auto">
          {shown.map((it) => {
            const id = res.idOf(it.name);
            const sel = it.key === selected;
            return (
              <button key={it.key} onClick={() => onSelect(it.key)} className={`flex items-start gap-2.5 w-full px-3 py-2 text-left transition-colors ${sel ? 'bg-accent/15' : 'hover:bg-field'}`}>
                <div className="flex-1 min-w-0"><CapeRow name={it.name} augs={it.aug} id={id} assets={assets} hasBmp={res.has(id)} /></div>
                <span className="shrink-0 self-center text-[13px] font-semibold text-accent whitespace-nowrap pl-3">{it.bagName}</span>
                {sel && <svg viewBox="0 0 24 24" className="shrink-0 w-4 h-4 text-accent self-center" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 6" /></svg>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GearPanel({ conn, charName, view, assets, inv, zone, fixedNear, experimental }: { conn: number; charName: string; view: string; assets?: string; inv?: InvBag[]; zone?: number; fixedNear?: string[]; experimental: boolean }) {
  const res = useNameResolver();
  const types = VIEW_TRADE_TYPES[view] ?? ['Cape'];
  const gearToType = useMemo(() => {
    const m = new Map<string, string>();
    for (const tid of types) for (const g of TRADE_TYPES[tid].gear) m.set(g.toLowerCase(), tid);
    return m;
  }, [types]);
  const instances = useMemo(() => gearInstancesFor(view, inv), [inv, view]);
  const k = (f: string) => augKey(view, charName, f);

  const [selKey, setSelKey] = useStickyPersisted(k('sel'), '');
  const sel = resolveSel(selKey, instances, inv);
  const item = sel?.name ?? (selKey.includes(':') ? '' : selKey);
  // Migrate a legacy bag:slot selection to the item name so it persists by identity.
  useEffect(() => { if (sel && sel.key !== selKey) setSelKey(sel.key); }, [sel?.key, selKey]);
  const selType = item ? TRADE_TYPES[gearToType.get(item.toLowerCase()) ?? ''] : undefined;
  const [material, setMaterial] = useStickyPersisted(k('mat'), '');
  const [style, setStyle] = useStickyPersisted<string>(k('style'), 'Melee');
  const [a1, setA1] = useStickyPersisted(k('a1'), '(any)'); const [v1, setV1] = useStickyPersisted(k('v1'), 0);
  const [a2, setA2] = useStickyPersisted(k('a2'), '(any)'); const [v2, setV2] = useStickyPersisted(k('v2'), 0);
  const [a3, setA3] = useStickyPersisted(k('a3'), '(any)'); const [v3, setV3] = useStickyPersisted(k('v3'), 0);
  const [augMode, setAugMode] = useStickyPersisted<'and' | 'or'>(k('amode'), 'and');
  const [delay, setDelay] = useStickyPersisted(k('delay'), 2);
  const [maxAttempts, setMaxAttempts] = useStickyPersisted(k('max'), 50);

  useEffect(() => {
    if (!item) return;
    const tid = gearToType.get(item.toLowerCase());
    const mats = tid ? TRADE_TYPES[tid].material : [];
    setMaterial((cur) => (mats.includes(cur) ? cur : mats.length === 1 ? mats[0] : ''));
  }, [item, gearToType]);

  const matList = selType?.material ?? [];
  const clean = (s: string) => (s === '(any)' ? '' : s);
  const richMenu = (n: string) => { const id = res.idOf(n); return <GearRow name={n} id={id} assets={assets} hasBmp={res.has(id)} showDesc />; };
  const richMenuCount = (n: string) => {
    const id = res.idOf(n);
    const { total, spots } = materialLocations(inv, n);
    const loc = total > 0 ? <>{spots.map((s, i) => <span key={s.bag}>{i > 0 && <span className="text-fg-5"> · </span>}<span className={`font-medium ${bagColor(s.bagId).text}`}>{s.bag}</span> {s.count}</span>)}</> : 'none in bags';
    return (
      <div className="flex items-center gap-2 min-w-0">
        <div className="min-w-0 flex-1"><GearRow name={n} id={id} assets={assets} hasBmp={res.has(id)} loc={loc} /></div>
        <span className={`shrink-0 text-[12px] font-bold tabular-nums ${total > 0 ? 'text-emerald-300' : 'text-fg-4'}`}>{total}</span>
      </div>
    );
  };
  const richValue = (hintLabel: string) => (n: string) => {
    if (n === '') return <span className="block text-center text-fg-4">{hintLabel}</span>;
    const id = res.idOf(n);
    return <div className="flex justify-center"><GearRow name={n} id={id} assets={assets} hasBmp={res.has(id)} /></div>;
  };

  const start = (manual: boolean) => {
    if (!selType || !sel) return;
    augGear(conn, {
      mode: selType.mode, item, bag: sel.bagId, slot: sel.slot, material,
      style: selType.style ? style : undefined,
      augment_1: clean(a1), augment_2: clean(a2), augment_3: clean(a3),
      watch_1: v1, watch_2: v2, watch_3: v3,
      augment_mode: augMode, delay, max: maxAttempts, manual,
    });
  };

  const locOk = !!selType && augLocOk(selType.mode, zone, fixedNear, experimental);
  const npcName = selType ? AUG_NPC[selType.mode]?.name : undefined;
  const baseReady = !!selType && item !== '' && material !== '' && locOk;
  const readyAuto = baseReady && (clean(a1) !== '' || clean(a2) !== '' || clean(a3) !== '');

  return (
    <>
      <Group title="Equipment">
        <div className="px-3.5 py-3">
          <EquipList items={instances} selected={sel?.key ?? ''} onSelect={setSelKey} res={res} assets={assets} />
        </div>
      </Group>
      {selType && (selType.style || (matList.length > 1 && selType.mode === 'Geas Fete')) && (
        <Group title="Augment">
          {matList.length > 1 && selType.mode === 'Geas Fete' && <RowStacked label="Stone"><Select value={material} onChange={setMaterial} options={matList} renderOption={richMenu} renderValue={richValue('Select…')} menuMaxH={360} full /></RowStacked>}
          {selType.style && <RowStacked label="Style"><Select value={style} onChange={setStyle} options={[...STYLES]} full /></RowStacked>}
        </Group>
      )}
      {selType && selType.mode !== 'Geas Fete' && matList.length === 1 && (
        <Group title="Material">
          <div className="px-3.5 py-3">
            <MaterialStock inv={inv} names={matList} res={res} assets={assets} selected={material} />
          </div>
        </Group>
      )}
      {selType && selType.mode !== 'Geas Fete' && matList.length > 1 && (
        <Group title="Material">
          <RowStacked label="Stone"><Select value={material} onChange={setMaterial} options={matList} renderOption={richMenuCount} renderValue={richValue('Select…')} menuMaxH={360} full /></RowStacked>
          {material && <div className="px-3.5 pb-3"><MaterialStock inv={inv} names={[material]} res={res} assets={assets} selected={material} /></div>}
        </Group>
      )}
      <Group title="Wanted Augments" right={<Segmented value={augMode} onChange={setAugMode} options={[{ v: 'and', label: 'Match All' }, { v: 'or', label: 'Match Any' }]} />}>
        <div className="pt-1">
          <AugRow idx={1} stat={a1} val={v1} onStat={setA1} onVal={setV1} />
          <AugRow idx={2} stat={a2} val={v2} onStat={setA2} onVal={setV2} />
          <AugRow idx={3} stat={a3} val={v3} onStat={setA3} onVal={setV3} />
        </div>
      </Group>
      <Group title="Limits">
        <RowStacked label="Delay" desc="Seconds between each reroll trade"><Slider value={delay} min={0} max={6} step={1} suffix="s" onChange={setDelay} /></RowStacked>
        <RowStacked label="Max Attempts" desc="Stops after this many rerolls if no match is found"><Slider value={maxAttempts} min={1} max={300} step={1} onChange={setMaxAttempts} /></RowStacked>
      </Group>
      <div className="px-1 flex gap-2">
        <button
          onClick={() => start(false)}
          disabled={!readyAuto}
          className="flex-1 px-3 py-2 text-[12px] font-bold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors"
        >
          Auto Roll
        </button>
        <button
          onClick={() => start(true)}
          disabled={!baseReady}
          className="flex-1 px-3 py-2 text-[12px] font-bold rounded-md bg-field border border-line text-fg-2 enabled:hover:bg-accent/10 enabled:hover:text-accent disabled:opacity-40 transition-colors"
        >
          Manual Roll
        </button>
      </div>
      {selType && item !== '' && !locOk && npcName && (
        <div className="px-1 mt-1.5 text-[11px] text-amber-300">{experimental ? `Travel to ${npcName}'s zone to augment.` : `Stand next to ${npcName} to augment.`}</div>
      )}
    </>
  );
}

function BatchStatus({ aug }: { aug?: AugState | null }) {
  if (!aug || (!aug.active && !aug.status)) return <span className="text-[10px] text-fg-4 shrink-0">idle</span>;
  if (aug.active) {
    const prog = aug.total && aug.total > 0 ? `${aug.attempts ?? 0}/${aug.total}` : `roll ${aug.attempts ?? 0}`;
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-accent shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
        <span className="tabular-nums">{prog}</span>
      </span>
    );
  }
  const ok = /match|kept|keep/i.test(aug.status ?? '');
  return <span className={`text-[10px] font-semibold shrink-0 ${ok ? 'text-emerald-300' : 'text-fg-4'}`}>{aug.status}</span>;
}

function BatchRollPanel({ view, online, experimental }: { view: string; online: KnownChar[]; experimental: boolean }) {
  useNowTick(1500);
  const anon = useAnon();
  const res = useNameResolver();
  const assets = useMemo(() => online.find((c) => c.assets)?.assets, [online]);
  const [excluded, setExcluded] = useStickyPersisted<string[]>(`aug.${view}.batchEx`, []);
  const exSet = useMemo(() => new Set(excluded), [excluded]);
  const toggleEx = (n: string) => setExcluded((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]));

  const mode = TRADE_TYPES[(VIEW_TRADE_TYPES[view] ?? [])[0] ?? '']?.mode;
  const npcName = mode ? AUG_NPC[mode]?.name : undefined;

  const rows = online.map((c) => {
    const cfg = readGearCfg(view, c.name, c.inv);
    const { ready, readyAuto } = cfgReady(view, cfg);
    const inRange = !!mode && augLocOk(mode, c.zone, c.fixedNear, experimental);
    const eligible = readyAuto && inRange;
    return { c, cfg, ready, readyAuto, inRange, eligible, included: eligible && !exSet.has(c.name) };
  });
  const includable = rows.filter((r) => r.eligible);
  const selected = rows.filter((r) => r.included);
  const anyActive = online.some((c) => c.aug?.active);

  const rollAll = () => {
    for (const r of rows) {
      if (r.c.conn == null || !r.included) continue;
      const arg = buildGearArg(view, r.cfg);
      if (arg) augGear(r.c.conn, arg);
    }
  };
  const setAll = (on: boolean) => setExcluded(on ? [] : includable.map((r) => r.c.name));

  return (
    <Group>
      <div className="flex items-center justify-between gap-2 px-3 py-2 text-[11px]">
        <span className="text-fg-4 tabular-nums">{selected.length}/{includable.length} selected</span>
        <span className="flex items-center gap-2">
          <button onClick={() => setAll(true)} className="le-tap font-semibold text-fg-4 hover:text-fg-2">All</button>
          <button onClick={() => setAll(false)} className="le-tap font-semibold text-fg-4 hover:text-fg-2">None</button>
        </span>
      </div>
      {rows.map(({ c, cfg, ready, readyAuto, inRange, eligible, included }) => (
        <div key={c.name} className="flex items-center gap-2.5 px-3 py-2">
          <button
            onClick={() => eligible && toggleEx(c.name)}
            disabled={!eligible}
            aria-label="Include in batch"
            className={`shrink-0 w-4 h-4 rounded border grid place-items-center transition-colors ${included ? 'bg-accent border-accent text-on-accent' : eligible ? 'border-line hover:border-accent' : 'border-line opacity-30 cursor-default'}`}
          >
            {included && <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 6" /></svg>}
          </button>
          {cfg.item ? (
            <div className="relative shrink-0 w-7 h-7 rounded bg-field grid place-items-center overflow-hidden">
              <IconInner id={res.idOf(cfg.item) ?? 0} size={28} name={cfg.item} assets={assets} bmpHas={res.has(res.idOf(cfg.item))} />
            </div>
          ) : (
            <div className="shrink-0 w-7" />
          )}
          <div className="min-w-0 flex-1">
            <span className="text-[12px] font-semibold text-fg-2 truncate block">{anon(c.name)}</span>
            <div className="text-[10px] truncate mt-0.5">
              {cfg.item === '' ? <span className="text-fg-4 italic">Not configured</span>
                : !ready ? <span className="text-amber-300">{cfg.item} · needs material</span>
                : !readyAuto ? <span className="text-amber-300">{cfg.item} · no wanted augments</span>
                : !inRange ? <span className="text-amber-300">{cfg.item} · {experimental ? `not in ${npcName}'s zone` : `not near ${npcName}`}</span>
                : <span className="text-fg-3">{cfg.item}<span className="text-fg-4"> · {wantedSummary(cfg)}</span></span>}
            </div>
          </div>
          <BatchStatus aug={c.aug} />
        </div>
      ))}
      <div className="px-3 py-3 flex flex-col gap-2">
        <div className="flex gap-2">
          <button onClick={rollAll} disabled={selected.length === 0} className="flex-1 px-3 py-2 text-[12px] font-bold rounded-md bg-accent text-on-accent enabled:hover:bg-accent-hover disabled:opacity-40 transition-colors">
            Roll {selected.length || ''} Character{selected.length === 1 ? '' : 's'}
          </button>
          <button onClick={() => void augStopAll()} disabled={!anyActive} className="shrink-0 px-3 py-2 text-[12px] font-bold rounded-md bg-red-500/15 text-red-300 border border-red-500/40 enabled:hover:bg-red-500/25 disabled:opacity-40 transition-colors">
            Stop All
          </button>
        </div>
      </div>
    </Group>
  );
}

function GearRoll({ view, online, active, experimental, tab, setTab }: { view: string; online: KnownChar[]; active: KnownChar; experimental: boolean; tab: 'single' | 'bulk'; setTab: (t: 'single' | 'bulk') => void }) {
  const conn = active.conn as number;
  const bulkActive = online.filter((c) => c.aug?.active).length;
  return (
    <div>
      <div className="mb-4">
        <SectionTabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'single', label: 'Single Roll' },
            { id: 'bulk', label: 'Bulk Roll', dot: bulkActive > 0 ? 'bg-accent' : undefined },
          ]}
        />
      </div>
      {tab === 'single'
        ? <GearPanel key={active.name} conn={conn} charName={active.name} view={view} assets={active.assets} inv={active.inv} zone={active.zone} fixedNear={active.fixedNear} experimental={experimental} />
        : <BatchRollPanel view={view} online={online} experimental={experimental} />}
    </div>
  );
}

export default function AugmentView({ view = 'ambuscade' }: { view?: 'ambuscade' | 'skirmish' | 'reive' | 'geasfete' }) {
  const known = useKnownCharacters();
  const exp = useSettings().experimentalFeatures;
  const online = known.filter((k) => k.online && k.conn != null);
  const [name, setName] = useStickyChar();
  const active = online.find((k) => k.name === name) ?? online[0];
  useEffect(() => { if (active && active.name !== name) setName(active.name); }, [active, name]);

  if (online.length === 0) {
    return (
      <div className="h-full grid place-items-center">
        <div className="text-center max-w-sm">
          <div className="text-[15px] font-bold text-fg mb-1">No Connected Characters</div>
          <div className="text-[12px] text-fg-4 leading-relaxed">Augmenting is driven live in-game. Load the Alexandria addon in-game to augment gear here.</div>
        </div>
      </div>
    );
  }

  const conn = active?.conn;
  const aug = active?.aug;
  const [rollTab, setRollTab] = useStickyPersisted<'single' | 'bulk'>('aug.rolltab', 'single');
  // The detailed per-item roll progress is a single-roll concern; during a bulk roll each
  // character's status is shown inline in the batch list instead.
  const showProgress = view === 'ambuscade' || rollTab === 'single';

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-4 pt-4 pb-3 border-b border-line flex items-center gap-2">
        <div className="flex-1 min-w-0"><CharacterSelect value={active?.name ?? ''} onChange={setName} chars={online} /></div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {showProgress && (
          <AugProgress
            aug={aug}
            assets={active?.assets}
            viewMode={VIEW_AUG_MODE[view]}
            onKeep={conn != null ? () => augKeep(conn) : undefined}
            onReroll={conn != null ? () => augReroll(conn) : undefined}
            onStop={conn != null ? () => augStop(conn) : undefined}
          />
        )}
        {conn != null && (
          <Crossfade id={view}>{view === 'ambuscade'
            ? <AmbuscadePanel conn={conn} assets={active?.assets} inv={active?.inv} zone={active?.zone} fixedNear={active?.fixedNear} experimental={exp} />
            : <GearRoll view={view} online={online} active={active!} experimental={exp} tab={rollTab} setTab={setRollTab} />}</Crossfade>
        )}
      </div>
    </div>
  );
}
