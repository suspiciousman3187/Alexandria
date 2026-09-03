import { useEffect, useState, type ReactNode } from 'react';
import { slipStore, slipRetrieve, type KnownChar, type Slip } from './bridge';
import { jobEquips } from './itemNames';
import { slipLabel } from './slipLabels';
import { useSlipExclusions, setSlipExclusions } from './slipOpConfig';
import OperationReport, { type ReportMove } from './OperationReport';
import SlipOpPreview from './SlipOpPreview';

// Shared logic for "Store / Retrieve every piece the character's CURRENT job uses" across all reachable
// storage slips. Used by both the Slips view and the Library toolbar. The addon consolidates the needed
// slips itself and cycles through them in one pass, so each action is a single slipStore / slipRetrieve.
export function usePorterGear(char?: KnownChar) {
  const conn = char?.conn ?? undefined;
  const near = !!char?.porterNear;
  const job = char?.main;
  const slips: Slip[] = char?.slips ?? [];

  const jobEq = job ? (id: number) => jobEquips(id, job) : null;
  const reachable = (s: Slip) => s.owned !== false && (s.ready || s.getable);
  const storeMoves: ReportMove[] = [];
  const retrieveMoves: ReportMove[] = [];
  if (jobEq) for (const s of slips) {
    if (!reachable(s)) continue;
    const label = slipLabel(s);
    for (const it of s.storable) if (jobEq(it.id)) storeMoves.push({ id: it.id, n: it.n, c: it.c ?? 1, from: 'Bags', to: label, fromId: -1, toId: -1 });
    for (const it of s.stored) if (jobEq(it.id)) retrieveMoves.push({ id: it.id, n: it.n, c: 1, from: label, to: 'Inventory', fromId: -1, toId: 0 });
  }
  const uniq = (a: number[]) => [...new Set(a)];
  const storeIds = uniq(storeMoves.map((m) => m.id));
  const retrieveIds = uniq(retrieveMoves.map((m) => m.id));
  const blockedCount = jobEq ? uniq(slips.filter((s) => s.owned !== false && !s.ready && !s.getable).flatMap((s) => [...s.storable, ...s.stored].filter((it) => jobEq(it.id)).map((it) => it.id))).length : 0;

  type RunState = { kind: 'store' | 'retrieve'; moves: ReportMove[]; startedAt: number; armed: boolean; done: boolean };
  const [run, setRun] = useState<RunState | null>(null);
  const porterActive = !!char?.porter?.active;
  useEffect(() => {
    if (!run || run.done) return;
    if (porterActive) { if (!run.armed) setRun((r) => (r ? { ...r, armed: true } : r)); return; }
    if (run.armed || Date.now() - run.startedAt > 5000) setRun((r) => (r && !r.done ? { ...r, done: true } : r));
  }, [porterActive, run]);

  const savedStore = useSlipExclusions(char?.name, 'store');
  const savedRetrieve = useSlipExclusions(char?.name, 'retrieve');
  type Preview = { kind: 'store' | 'retrieve'; moves: ReportMove[] };
  const [preview, setPreview] = useState<Preview | null>(null);
  const openStore = () => { if (storeMoves.length) setPreview({ kind: 'store', moves: storeMoves }); };
  const openRetrieve = () => { if (retrieveMoves.length) setPreview({ kind: 'retrieve', moves: retrieveMoves }); };
  const saveExclusions = (excludedNow: number[]) => {
    if (!preview || !char?.name) return;
    const here = new Set(preview.moves.map((m) => m.id));
    const saved = preview.kind === 'store' ? savedStore : savedRetrieve;
    setSlipExclusions(char.name, preview.kind, [...saved.filter((id) => !here.has(id)), ...excludedNow]);
  };
  const confirmOp = (ids: number[]) => {
    const p = preview; setPreview(null);
    if (!p || conn == null || ids.length === 0) return;
    if (p.kind === 'store') slipStore(conn, ids); else slipRetrieve(conn, ids);
    setRun({ kind: p.kind, moves: p.moves.filter((m) => ids.includes(m.id)), startedAt: Date.now(), armed: false, done: false });
  };

  const modals: ReactNode = (
    <>
      {preview && (
        <SlipOpPreview
          kind={preview.kind}
          moves={preview.moves}
          assets={char?.assets}
          initialExcluded={preview.kind === 'store' ? savedStore : savedRetrieve}
          onExcludedChange={saveExclusions}
          onCancel={() => setPreview(null)}
          onConfirm={confirmOp}
        />
      )}
      {run?.done && (
        <OperationReport
          report={{ kind: run.kind, blocks: [{ name: char?.name ?? '', assets: char?.assets, moves: run.moves, skipped: [] }] }}
          onClose={() => setRun(null)}
        />
      )}
    </>
  );

  return { job, near, storeIds, retrieveIds, blockedCount, running: !!run && !run.done, openStore, openRetrieve, modals };
}
