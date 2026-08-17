import { useSyncExternalStore, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { getKnownCharacters, useKnownCharacters, useItem, useStop, NOMAD_BAGS, inNomadZone, type KnownChar } from './bridge';
import { MOG_ONLY_BAGS } from './bagConstants';
import { OpCard } from './OpCard';
import { useAnon } from './anonymize';

// Mirrors the addon's USE_BAGS: bags a Use can pull from directly (inventory + satchel/sack/case).
const USE_BAGS = new Set([0, 3, 5, 6, 7]);
// Where a character can get one of the item for a Use One Everywhere. Prefer a directly-usable bag
// (pass 0 so the addon finds/auto-pulls it); otherwise the first reachable bag it holds it in
// (wardrobes anywhere; Mog storage only at a Moogle), which the addon moves into inventory first so
// the character can still take part.
function useSource(char: KnownChar, id: number): { bag: number; slot: number } | null {
  let fallback: { bag: number; slot: number } | null = null;
  for (const b of char.inv ?? []) {
    for (const it of b.items) {
      if (it.id !== id) continue;
      if (USE_BAGS.has(b.id)) return { bag: 0, slot: it.s };
      const reachable = !MOG_ONLY_BAGS.has(b.id) || !!char.mog || (NOMAD_BAGS.has(b.id) && inNomadZone(char.zone));
      if (!fallback && reachable) fallback = { bag: b.id, slot: it.s };
    }
  }
  return fallback;
}

// "Use All Everywhere" is fired from a transient inventory row. Hosting the progress here at
// the app root (like Distribute) keeps it alive and non-blocking while the user keeps working.
type Op = { id: number; name: string; conns: number[]; all: boolean } | null;
let op: Op = null;
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

// all=false uses exactly one copy per character (e.g. one Ambuscade seal each); all=true uses every
// copy. Either way the addon pulls from the carry bags (Satchel/Sack/Case) as needed.
export function openUseAll(id: number, name: string, all = true) {
  const targets: { conn: number; bag: number; slot: number }[] = [];
  for (const c of getKnownCharacters()) {
    if (!c.online || c.conn == null) continue;
    const src = useSource(c, id);
    if (src) targets.push({ conn: c.conn, bag: src.bag, slot: src.slot });
  }
  if (!targets.length) return;
  for (const t of targets) useItem(t.conn, id, all, t.bag, t.bag === 0 ? undefined : t.slot);
  op = { id, name, conns: targets.map((t) => t.conn), all };
  notify();
}
export function closeUseAll() { op = null; notify(); }
function stopUseAll() { if (op) for (const conn of op.conns) useStop(conn); }

function useOp(): Op {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => op, () => op);
}

export function UseAllHost() {
  const cur = useOp();
  const known = useKnownCharacters();
  const anon = useAnon();
  const [everActive, setEverActive] = useState(false);

  const byConn = useMemo(() => {
    const m = new Map<number, KnownChar>();
    for (const c of known) if (c.conn != null) m.set(c.conn, c);
    return m;
  }, [known]);

  // Per-character progress pulled from each character's own useProg for this op's item.
  const per = useMemo(() => (cur?.conns ?? []).map((conn) => {
    const c = byConn.get(conn);
    const up = c?.useProg;
    const mine = !!(up && up.id === cur!.id);
    return { conn, name: c?.name ?? '?', active: !!(mine && up!.active), done: mine ? up!.done : 0, total: mine ? up!.total : 0, mine };
  }), [cur, byConn]);

  const anyActive = per.some((p) => p.active);
  const sumDone = per.reduce((s, p) => s + p.done, 0);
  const sumTotal = per.reduce((s, p) => s + p.total, 0);
  const pct = sumTotal > 0 ? Math.round((sumDone / sumTotal) * 100) : anyActive ? 0 : 100;
  // Only "done" once a character was actually seen using -- otherwise the moment before any
  // useProg arrives would read as instantly finished.
  const allDone = !!cur && everActive && !anyActive;
  const doneCount = per.filter((p) => !p.active && (allDone || (p.mine && p.total > 0 && p.done >= p.total))).length;

  useEffect(() => { if (!cur) setEverActive(false); }, [cur]);
  useEffect(() => { if (anyActive && !everActive) setEverActive(true); }, [anyActive, everActive]);
  useEffect(() => {
    if (!cur) return;
    if (allDone) { const t = window.setTimeout(closeUseAll, 5000); return () => window.clearTimeout(t); }
    if (!everActive) { const t = window.setTimeout(() => { if (!everActive) closeUseAll(); }, 12000); return () => window.clearTimeout(t); }
  }, [cur, allDone, everActive]);

  if (!cur) return null;

  return (
    <div className="fixed bottom-3 right-3 z-[60] w-[280px] pointer-events-none">
      <AnimatePresence initial={false}>
        <motion.div
          key="useall"
          layout
          initial={{ opacity: 0, x: 24, scale: 0.96 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 24, scale: 0.96 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="pointer-events-auto"
        >
          <OpCard
            state={allDone ? 'ok' : 'active'}
            title={`${cur.all ? 'Use All' : 'Use One'} · ${cur.name}`}
            sublabel={allDone ? `Used on ${cur.conns.length} character${cur.conns.length === 1 ? '' : 's'}` : everActive ? `${doneCount}/${cur.conns.length} characters done` : 'Starting…'}
            count={sumTotal > 0 ? `${sumDone}/${sumTotal}` : undefined}
            pct={pct}
            className="shadow-lg"
            trailing={allDone ? (
              <button onClick={closeUseAll} aria-label="Dismiss" className="le-tap shrink-0 text-fg-4 hover:text-fg transition-colors">
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
            ) : (
              <button onClick={stopUseAll} aria-label="Stop" title="Stop" className="le-tap shrink-0 text-fg-4 hover:text-rose-300 transition-colors">
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="1.5" /></svg>
              </button>
            )}
          >
            {cur.conns.length > 1 && (
              <div className="flex flex-col gap-1 max-h-[150px] overflow-y-auto">
                {per.map((p) => {
                  const done = !p.active && (allDone || (p.mine && p.total > 0 && p.done >= p.total));
                  return (
                    <div key={p.conn} className="flex items-center gap-1.5 text-[10px]">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.active ? 'bg-accent animate-pulse' : done ? 'bg-emerald-400' : 'bg-fg-4'}`} />
                      <span className="min-w-0 flex-1 truncate text-fg-3">{anon(p.name)}</span>
                      <span className="shrink-0 tabular-nums text-fg-4">{p.total > 0 ? `${p.done}/${p.total}` : done ? 'done' : '…'}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </OpCard>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
