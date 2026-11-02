import { useMemo, useState, useEffect, type ReactNode } from 'react';
import { type KnownChar, type Slip, useAvailableIcons, useAddonInfo } from './bridge';
import { useSettings } from './settings';
import { deriveGearswapData } from './gearset/gearsetFiles';
import { gearsetItemIds } from './gearset/gearsetPullIds';
import { slipLabel } from './slipLabels';
import { useItemTags } from './itemTags';
import { usePullRules, setPullRules, newPullId, type PullRule } from './pullRules';
import { Modal } from './overlay';
import OperationReport, { type ReportMove } from './OperationReport';
import { Button, Toggle } from './ui';
import { IconInner } from './atlasIcon';
import { JOB_LIST, itemCategory, ITEM_CATEGORIES, type ItemCategory } from './itemNames';
import { SRC_BAGS, DEST_BAGS, bagLabel, destLabel, planPull, planMoves, firePull, destsOf, destCapacity, type PullCtx, type PlannedMove } from './pullEngine';

export default function PullButton({ char, conn, compact }: { char?: KnownChar; conn?: number; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {compact ? (
        <Button variant="secondary" size="sm" className="shrink-0" onClick={() => setOpen(true)} disabled={!char} title="Pull tagged gear into inventory">Pull</Button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          disabled={!char}
          title="Pull tagged gear into inventory"
          className="shrink-0 h-[30px] px-3 rounded-md border text-[12px] font-bold tracking-wide bg-field text-fg-3 border-line enabled:hover:text-fg-2 enabled:hover:border-accent/40 disabled:opacity-40 transition-colors"
        >
          PULL
        </button>
      )}
      {open && char && <PullModal char={char} conn={conn} onClose={() => setOpen(false)} />}
    </>
  );
}

function PullModal({ char, conn, onClose }: { char: KnownChar; conn?: number; onClose: () => void }) {
  const rules = usePullRules();
  const { tags, assign, assignAug } = useItemTags();
  const iconSet = useAvailableIcons();
  const [edit, setEdit] = useState<PullRule | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null); // preset id whose matched-item preview is open
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set()); // "<ruleId>:<slot>" headers collapsed in the preview
  const toggleCat = (key: string) => setCollapsedCats((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const [note, setNote] = useState('');
  type RunState = { name: string; planned: number; blocked: string; moves: ReportMove[]; before: Map<number, Map<number, number>>; dests: number[]; startedAt: number; lastChange: number; landed: number; done: boolean };
  const [run, setRun] = useState<RunState | null>(null);
  const countByBag = (bags: number[]) => { const m = new Map<number, Map<number, number>>(); const set = new Set(bags); for (const bg of char.inv ?? []) { if (!set.has(bg.id)) continue; const im = m.get(bg.id) ?? new Map<number, number>(); for (const it of bg.items) im.set(it.id, (im.get(it.id) ?? 0) + it.c); m.set(bg.id, im); } return m; };
  const landedNow = (rs: RunState) => { const cur = countByBag(rs.dests); let n = 0; for (const bag of rs.dests) { const bef = rs.before.get(bag), cm = cur.get(bag) ?? new Map<number, number>(); for (const [id, c] of cm) { const d = c - (bef?.get(id) ?? 0); if (d > 0) n += d; } } return n; };

  // Advance the run as inventory updates, and finalize on completion / stall / timeout.
  useEffect(() => {
    if (!run || run.done) return;
    const tick = () => setRun((prev) => {
      if (!prev || prev.done) return prev;
      const landed = landedNow(prev); const now = Date.now();
      const lastChange = landed !== prev.landed ? now : prev.lastChange;
      const done = now - prev.startedAt > 60000 || landed >= prev.planned || now - lastChange > 6000;
      return { ...prev, landed, lastChange, done };
    });
    tick();
    const t = setInterval(tick, 900);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [char.inv, run?.done, run?.startedAt]);

  const exp = useSettings().experimentalFeatures;
  // Resolve the current job's GearSwap set items, but only while a preset actually uses gearsetOnly.
  // undefined = loading/not needed, null = no gear file for this job. gearsetOnly rules pull nothing
  // until this is a real set, so a missing/unreadable file never degrades to "pull everything".
  const addon = useAddonInfo();
  const gearswapBase = useSettings().gearswapPath || (addon?.dir ? deriveGearswapData(addon.dir) : '');
  const anyGearset = rules.some((r) => r.gearsetOnly);
  const [gearIds, setGearIds] = useState<Set<number> | null | undefined>(undefined);
  useEffect(() => {
    if (!anyGearset || !gearswapBase || !char.main) { setGearIds(null); return; }
    let alive = true;
    setGearIds(undefined);
    void gearsetItemIds(gearswapBase, char.name, char.main).then((s) => { if (alive) setGearIds(s); });
    return () => { alive = false; };
  }, [anyGearset, gearswapBase, char.name, char.main]);

  const ctx: PullCtx = { assign, assignAug, gearIds: gearIds ?? null, exp };
  const planFor = useMemo(() => (r: PullRule) => planPull(char, r, ctx),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [char.inv, char.slips, char.mog, assign, assignAug, gearIds, exp]);

  const execPull = (r: PullRule) => {
    if (conn == null) { setNote('This character is offline. Connect it in-game to pull.'); return; }
    const before = countByBag([...new Set([...destsOf(r), 0])]); // snapshot BEFORE firing, to measure what lands
    const res = firePull(char, conn, r, ctx);
    if (res.movedBag + res.slipTake === 0) { setNote(res.blocked.length ? `Nothing pulled: ${res.blocked.join('; ')}.` : `Nothing matches "${r.name}"${r.jobOnly ? ` on ${char.main ?? '???'}` : ''}.`); return; }
    setNote('');
    setRun({ name: r.name, planned: res.movedItems + res.slipTake, blocked: res.blocked.join('; '), moves: res.moves, before, dests: res.tracked, startedAt: Date.now(), lastChange: Date.now(), landed: 0, done: false });
  };

  const save = (r: PullRule) => {
    const clean: PullRule = { ...r, name: r.name.trim() || 'Pull' };
    setPullRules(rules.some((x) => x.id === r.id) ? rules.map((x) => (x.id === r.id ? clean : x)) : [...rules, clean]);
    setEdit(null);
  };
  const del = (id: string) => { setPullRules(rules.filter((x) => x.id !== id)); if (edit?.id === id) setEdit(null); };

  return (
    <>
    <Modal onClose={onClose} panelClass="w-[min(94vw,520px)] max-h-[86vh]">
      {(close) => (
        <div className="flex flex-col min-h-0 max-h-[86vh]">
          <div className="shrink-0 flex items-center gap-2 px-4 pt-3.5 pb-3 border-b border-line">
            <div className="text-[14px] font-bold text-fg flex-1">Pull To Inventory <span className="text-fg-4 font-medium text-[12px]">· {char.name}{char.main ? ` (${char.main})` : ''}</span></div>
            <button onClick={close} aria-label="Close" className="grid place-items-center w-7 h-7 rounded-md text-fg-4 hover:text-fg hover:bg-line transition-colors">×</button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-2">
            {note && <div className="text-[11.5px] text-accent bg-accent/10 border border-accent/25 rounded-lg px-3 py-2">{note}</div>}

            {run && !run.done && (
              <div className="rounded-xl border border-line bg-surface p-3">
                <div className="flex items-center gap-2">
                  <svg viewBox="0 0 24 24" className="w-4 h-4 text-accent animate-spin" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.5" /></svg>
                  <span className="text-[12.5px] font-bold text-fg">Pulling…</span>
                  <span className="text-[11px] text-fg-4 truncate">{run.name}</span>
                  <span className="ml-auto text-[11px] font-bold tabular-nums text-fg-4">{run.landed}/{run.planned}</span>
                </div>
                <div className="h-1.5 rounded-full bg-field overflow-hidden mt-2"><div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${run.planned ? Math.min(100, (run.landed / run.planned) * 100) : 100}%` }} /></div>
              </div>
            )}

            {rules.length === 0 && !edit && (
              <div className="text-center rounded-lg border border-dashed border-line bg-surface/40 px-3 py-4">
                <div className="text-[13px] font-semibold text-fg-3">No pull presets yet!</div>
                <div className="text-[12px] text-fg-4 mt-1">Create one below.</div>
              </div>
            )}

            {!edit && rules.map((r) => {
              const p = planFor(r);
              const n = p.bagOK.length + (char.porterNear ? p.slipReady.length : 0);
              const slipPending = r.slips && p.slipReady.length > 0 && !char.porterNear;
              const getPending = r.slips && p.needGet.length > 0;
              const mogPending = p.blockedBags.size > 0;
              const slipSrc = r.slips ? (r.slipSids?.length ? `${r.slipSids.length} slip(s)` : 'all slips') : null;
              const srcs = [...r.bags.map(bagLabel), ...(slipSrc ? [slipSrc] : [])];
              const destStr = destsOf(r).map(destLabel).join(' > ');
              const full = p.bagOK.length > destCapacity(char, r);
              const isExp = expanded === r.id;
              return (
                <div key={r.id} className="rounded-xl border border-line bg-surface">
                  <div className="flex items-center gap-2.5 px-2 py-2.5">
                    <button onClick={() => setExpanded(isExp ? null : r.id)} title={isExp ? 'Hide the matching pieces' : 'Show the pieces this will pull'} aria-expanded={isExp}
                      className="shrink-0 w-5 h-5 grid place-items-center rounded text-fg-4 hover:text-fg transition-colors">
                      <svg viewBox="0 0 24 24" className={`w-3.5 h-3.5 transition-transform ${isExp ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-fg truncate">{r.name}</div>
                      <div className="text-[10.5px] text-fg-4 truncate mt-0.5">
                        {r.tags.map((t) => tags.find((x) => x.id === t)?.name ?? '?').join(', ') || 'no tags'} · from {srcs.join(', ') || 'no source'} · into {destStr}{r.jobOnly ? ' · current job' : ''}{r.jobSpecific ? ' · job-specific' : ''}{r.gearsetOnly ? ' · gearswap set' : ''}
                      </div>
                    </div>
                    {full && <span className="shrink-0 text-[9px] font-bold uppercase text-amber-300" title="Not enough room across the destination bags for everything; add more fallback bags or free space">Full</span>}
                    {mogPending && <span className="shrink-0 text-[9px] font-bold uppercase text-amber-300" title="Some matches are in Mog House storage; go to a Mog House or Nomad Moogle">Mog</span>}
                    {getPending && <span className="shrink-0 text-[9px] font-bold uppercase text-sky-300" title={`${p.needGet.length} slip(s) aren't in your bags${r.autoGetSlips ? '; Pull will fetch them first' : '; turn on Auto-fetch or get them first'}`}>Slip</span>}
                    {slipPending && <span className="shrink-0 text-[9px] font-bold uppercase text-amber-300" title="Some pieces are on Storage Slips; stand by the Porter Moogle to retrieve them">Porter</span>}
                    <span className={`shrink-0 text-[11px] font-bold tabular-nums ${n ? 'text-emerald-300' : 'text-fg-4'}`}>{n} ready</span>
                    <Button variant="primary" size="sm" onClick={() => execPull(r)} disabled={n === 0 && !(getPending && r.autoGetSlips)}>Pull</Button>
                    <button onClick={() => setEdit(r)} title="Edit" className="shrink-0 w-7 h-7 grid place-items-center rounded-md text-fg-4 hover:text-fg hover:bg-field transition-colors">✎</button>
                    <button onClick={() => del(r.id)} title="Delete" className="shrink-0 w-7 h-7 grid place-items-center rounded-md text-fg-4 hover:text-rose-300 hover:bg-rose-500/10 transition-colors">🗑</button>
                  </div>
                  {isExp && (() => {
                    // Exactly what this preset would move right now, with the SAME routing the pull uses (its
                    // "current job" filter applied, each piece's real source bag and destination resolved).
                    const plan = planMoves(char, r, { assign, assignAug, gearIds: gearIds ?? null, exp });
                    if (!plan.moves.length) {
                      const gsNote = r.gearsetOnly ? (gearIds === undefined ? ' (reading GearSwap sets…)' : gearIds === null ? ` (no GearSwap file found for ${char.main ?? 'this job'})` : '') : '';
                      return <div className="px-3 pb-2.5 pt-1.5 border-t border-line text-[11px] text-fg-4">Nothing matches right now{r.jobOnly ? ` for ${char.main ?? 'this job'}` : ''}{gsNote}.</div>;
                    }
                    // Group by equipment slot so the preview reads like a gear set, in slot order (weapon -> back).
                    const byCat = new Map<ItemCategory, PlannedMove[]>();
                    for (const m of plan.moves) { const c = itemCategory(m.id); const g = byCat.get(c) ?? []; g.push(m); byCat.set(c, g); }
                    const groups = ITEM_CATEGORIES.filter((c) => byCat.has(c.id))
                      .map((c) => ({ id: c.id, label: c.label, moves: byCat.get(c.id)!.sort((a, b) => a.n.localeCompare(b.n)) }));
                    const total = plan.moves.reduce((s, m) => s + m.count, 0);
                    return (
                      <div className="px-2 pb-2 pt-1.5 border-t border-line flex flex-col gap-1.5 max-h-[320px] overflow-y-auto overscroll-contain">
                        <div className="px-1 text-[9px] font-bold uppercase tracking-[0.1em] text-fg-4">Will pull {total} piece{total === 1 ? '' : 's'} · {groups.length} slot{groups.length === 1 ? '' : 's'}</div>
                        {groups.map((g) => {
                          const key = `${r.id}:${g.id}`;
                          const open = !collapsedCats.has(key);
                          const slotN = g.moves.reduce((s, m) => s + m.count, 0);
                          return (
                            <div key={g.id} className="flex flex-col gap-0.5">
                              <button onClick={() => toggleCat(key)} aria-expanded={open} className="le-tap flex items-center gap-2 px-1 py-0.5 rounded hover:bg-field/50 transition-colors">
                                <svg viewBox="0 0 24 24" className={`w-3 h-3 shrink-0 text-fg-4 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
                                <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-accent/80">{g.label}</span>
                                <span className="flex-1 h-px" style={{ background: 'var(--color-line)' }} />
                                <span className="text-[9px] font-semibold tabular-nums text-fg-4">{slotN}</span>
                              </button>
                              {open && g.moves.map((m, i) => (
                                <div key={`${m.id}:${m.from}:${i}`} className="flex items-center gap-2 pl-5 pr-1.5 py-1 rounded hover:bg-field/60">
                                  <span className="w-6 h-6 rounded bg-field grid place-items-center overflow-hidden shrink-0"><IconInner id={m.id} size={24} name={m.n} assets={char.assets} bmpHas={m.id > 0 && iconSet.has(m.id)} /></span>
                                  <span className="text-[11.5px] text-fg-2 truncate flex-1">{m.n}{m.count > 1 ? <span className="text-fg-4"> ×{m.count}</span> : null}</span>
                                  <span className="shrink-0 inline-flex items-center gap-1 text-[9px] font-semibold">
                                    <span className="text-fg-4">{m.fromLabel.replace('Mog ', '')}</span>
                                    <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 text-fg-4/70" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>
                                    <span className="text-emerald-300/90">{m.toLabel.replace('Mog ', '')}</span>
                                  </span>
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              );
            })}

            {edit ? <PullEditor rule={edit} tags={tags} slips={char.slips ?? []} onCancel={() => setEdit(null)} onSave={save} />
              : <Button variant="secondary" onClick={() => setEdit({ id: newPullId(), name: '', tags: [], bags: [6], jobOnly: true, dest: [0] })}>＋ New Pull Preset</Button>}
          </div>
        </div>
      )}
    </Modal>
    {run?.done && <OperationReport report={{ kind: 'pull', blocks: [{ name: char.name, assets: char.assets, moves: run.moves, skipped: [] }] }} onClose={() => setRun(null)} />}
    </>
  );
}

function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface/50 overflow-hidden">
      <div className="flex items-center gap-2 px-3 h-8 bg-field/60 border-b border-line">
        <span className="text-[11px] font-bold uppercase tracking-[0.07em] text-fg-2">{title}</span>
        {hint && <span className="ml-auto text-[10.5px] text-fg-4">{hint}</span>}
      </div>
      <div className="p-2.5 flex flex-col gap-2.5">{children}</div>
    </div>
  );
}

function Chip({ on, onClick, color, title, children }: { on: boolean; onClick: () => void; color?: string; title?: string; children: ReactNode }) {
  const style = color ? (on ? { backgroundColor: `${color}26`, color, borderColor: `${color}66` } : { color, borderColor: 'var(--color-line)' }) : undefined;
  const cls = color ? '' : (on ? 'bg-accent/15 text-accent border-accent/50' : 'bg-field/40 text-fg-3 border-line hover:text-fg-2 hover:border-line-2');
  return <button onClick={onClick} title={title} style={style} className={`w-full px-2 py-1 rounded-md text-[11.5px] border font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap overflow-hidden transition-colors ${cls}`}>{children}</button>;
}

function PullEditor({ rule, tags, slips, onCancel, onSave }: { rule: PullRule; tags: { id: string; name: string; color: string }[]; slips: Slip[]; onCancel: () => void; onSave: (r: PullRule) => void }) {
  const [r, setR] = useState<PullRule>(rule);
  const toggleTag = (id: string) => setR((p) => ({ ...p, tags: p.tags.includes(id) ? p.tags.filter((x) => x !== id) : [...p.tags, id] }));
  const toggleBag = (id: number) => setR((p) => ({ ...p, bags: p.bags.includes(id) ? p.bags.filter((x) => x !== id) : [...p.bags, id] }));
  const toggleSlip = (sid: number) => setR((p) => { const cur = new Set(p.slipSids ?? []); if (cur.has(sid)) cur.delete(sid); else cur.add(sid); return { ...p, slipSids: [...cur] }; });
  const ownedSlips = slips.filter((s) => s.owned !== false);
  const dest = r.dest && r.dest.length ? r.dest : [0];
  const addDest = (id: number) => setR((p) => { const cur = p.dest && p.dest.length ? p.dest : [0]; return cur.includes(id) ? p : { ...p, dest: [...cur, id] }; });
  const removeDest = (id: number) => setR((p) => { const cur = (p.dest && p.dest.length ? p.dest : [0]).filter((x) => x !== id); return { ...p, dest: cur.length ? cur : [0] }; });
  const moveUp = (i: number) => setR((p) => { const cur = [...(p.dest && p.dest.length ? p.dest : [0])]; if (i <= 0) return p; [cur[i - 1], cur[i]] = [cur[i], cur[i - 1]]; return { ...p, dest: cur }; });
  const sourceCount = r.bags.length + (r.slips ? 1 : 0);
  return (
    <div className="rounded-xl border border-accent/40 bg-surface-raised p-2.5 flex flex-col gap-2.5">
      <input value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} placeholder="Preset name" autoFocus
        className="w-full h-10 rounded-lg bg-field border border-line text-fg px-3 text-[14px] font-semibold outline-none focus:border-accent placeholder-fg-4" />

      <Section title="Tags" hint={r.tags.length ? `${r.tags.length} tag${r.tags.length === 1 ? '' : 's'}` : 'optional'}>
        {tags.length === 0 ? <div className="text-[11px] text-fg-4">No tags yet.</div> : (
          <div className="grid grid-cols-3 gap-1.5">
            {tags.map((t) => (
              <Chip key={t.id} on={r.tags.includes(t.id)} onClick={() => toggleTag(t.id)} color={t.color}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: t.color }} />{t.name}
              </Chip>
            ))}
          </div>
        )}
      </Section>

      <Section title="Pull From" hint={sourceCount ? `${sourceCount} source${sourceCount === 1 ? '' : 's'}` : 'pick a source'}>
        <div className="grid grid-cols-4 gap-1.5">
          <Chip on={!!r.slips} onClick={() => setR({ ...r, slips: !r.slips })} title="Retrieve matching gear stored on Porter Moogle slips">Storage Slips</Chip>
          {SRC_BAGS.map((b) => <Chip key={b.id} on={r.bags.includes(b.id)} onClick={() => toggleBag(b.id)}>{b.label}</Chip>)}
        </div>
      </Section>

      {r.slips && (
        <Section title="Storage Slips" hint={!r.slipSids?.length ? 'all owned' : `${r.slipSids.length} selected`}>
          {ownedSlips.length === 0 ? <div className="text-[11px] text-fg-4">No slips detected.</div> : (
            <div className="grid grid-cols-3 gap-1.5">
              {ownedSlips.map((s) => (
                <Chip key={s.sid} on={!!r.slipSids?.includes(s.sid)} onClick={() => toggleSlip(s.sid)} title={`${s.name}: ${slipLabel(s)}${s.ready ? '' : ' (not in bags)'}`}>
                  <span className="truncate">{slipLabel(s)}</span>{!s.ready && <span className="text-amber-300 shrink-0">•</span>}
                </Chip>
              ))}
            </div>
          )}
          <label className="flex items-center gap-2.5 text-[12px] text-fg-2 pt-0.5">
            <Toggle on={!!r.autoGetSlips} onChange={(v) => setR({ ...r, autoGetSlips: v })} />
            Auto-fetch missing slips
          </label>
        </Section>
      )}

      <Section title="Destination Bags" hint="fill in order">
        {dest.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {dest.map((id, i) => (
              <span key={id} className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md text-[11.5px] border border-accent/50 bg-accent/15 text-accent font-semibold">
                <span className="tabular-nums opacity-60">{i + 1}</span>{destLabel(id)}
                {i > 0 && <button onClick={() => moveUp(i)} title="Move up" className="w-4 text-center text-accent/70 hover:text-accent">↑</button>}
                <button onClick={() => removeDest(id)} title="Remove" className="w-4 text-center text-accent/70 hover:text-rose-300">×</button>
              </span>
            ))}
          </div>
        )}
        <div className="grid grid-cols-4 gap-1.5">
          {DEST_BAGS.filter((b) => !dest.includes(b.id)).map((b) => (
            <button key={b.id} onClick={() => addDest(b.id)} className="w-full px-2 py-1 rounded-md text-[11.5px] border font-semibold bg-field/40 text-fg-3 border-line hover:text-fg-2 hover:border-line-2 whitespace-nowrap overflow-hidden transition-colors">＋ {b.label}</button>
          ))}
        </div>
      </Section>

      <Section title="Options">
        <label className="flex items-start gap-2.5">
          <Toggle on={r.jobOnly} onChange={(v) => setR({ ...r, jobOnly: v })} />
          <span className="text-[12px] text-fg-2 leading-5">Only pull gear the current job can equip</span>
        </label>
        <label className="flex items-start gap-2.5">
          <Toggle on={!!r.jobSpecific} onChange={(v) => setR({ ...r, jobSpecific: v })} />
          <span className="text-[12px] text-fg-2 leading-5">Only pull Job-specific gear<span className="block text-[11px] text-fg-4 leading-4">Excludes all-job costume/generic multi-job equipment</span></span>
        </label>
        <label className="flex items-start gap-2.5">
          <Toggle on={!!r.gearsetOnly} onChange={(v) => setR({ ...r, gearsetOnly: v })} />
          <span className="text-[12px] text-fg-2 leading-5">Only pull gear from the character's GearSwap job file<span className="block text-[11px] text-fg-4 leading-4">Reads this character's current-job .lua; pulls only pieces a set uses</span></span>
        </label>
        <label className="flex items-start gap-2.5">
          <Toggle on={!!r.autoOnJobChange} onChange={(v) => setR({ ...r, autoOnJobChange: v })} />
          <span className="text-[12px] text-fg-2 leading-5">Auto-pull gear on Job Change<span className="block text-[11px] text-fg-4 leading-4">{r.slips ? 'When the Porter and these bags are reachable, e.g. a Mog Garden' : 'When these source bags are reachable'}</span></span>
        </label>
        {r.autoOnJobChange && (
          <div className="ml-9 flex flex-col gap-1.5">
            <span className="text-[11px] text-fg-4">Run only when switching to {r.jobs && r.jobs.length ? 'these jobs' : 'any job'} <span className="text-fg-4/70">(leave empty for any job)</span></span>
            <div className="grid grid-cols-4 gap-1.5">
              {JOB_LIST.map((j) => {
                const on = !!r.jobs?.includes(j);
                return <Chip key={j} on={on} onClick={() => setR({ ...r, jobs: on ? (r.jobs ?? []).filter((x) => x !== j) : [...(r.jobs ?? []), j] })}>{j}</Chip>;
              })}
            </div>
          </div>
        )}
      </Section>

      <div className="flex gap-2 justify-end pt-0.5">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={() => onSave(r)} disabled={r.bags.length === 0 && !r.slips}>Save</Button>
      </div>
    </div>
  );
}
