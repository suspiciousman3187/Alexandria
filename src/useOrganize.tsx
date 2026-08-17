import { useEffect, useRef, useState, type ReactNode } from 'react';
import { runOrganize, useAvailableIcons, type KnownChar, type OrgStep, type OrganizeRules } from './bridge';
import { loadOrganizeRules } from './organizeRules';
import { resolveLayout } from './tagRules';
import { bagIdByName } from './bagNames';
import { OrganizePreviewModal } from './OrganizePreviewModal';
import OperationReport, { type ReportData, type ReportBlock, type ReportMove } from './OperationReport';

// The one Organize flow, shared by Library mode and the Tools Organize view:
// preview (dry-run) -> confirm -> run, then a result report when it finishes.
// `nodes` renders the preview + report modals; drop it once in the host view.
export function useOrganize(chars: KnownChar[], opts?: { grouped?: boolean; title?: string }) {
  const iconSet = useAvailableIcons();
  const [rules, setRules] = useState<OrganizeRules | null>(null); // non-null while the preview is open
  const [report, setReport] = useState<ReportData | null>(null);
  const [lastReport, setLastReport] = useState<ReportData | null>(null);
  const watched = useRef(new Set<string>());

  const targets = chars.filter((c) => c.online && c.conn != null);
  const grouped = opts?.grouped ?? targets.length > 1;

  const openPreview = async () => { setRules(await loadOrganizeRules()); };
  const closePreview = () => setRules(null);

  // Fired from the preview's "Organize Now". Arm the report watch at fire time,
  // not from observing org.active: the fast move lane can finish before the
  // desktop ever renders the active state.
  const run = async () => {
    setRules(null);
    const r = await loadOrganizeRules();
    for (const ch of targets) { watched.current.add(ch.name); runOrganize(ch.conn!, r, resolveLayout(ch)); }
  };

  const buildBlock = (ch: KnownChar): ReportBlock | null => {
    const plan = ch.orgPlan ?? []; if (!plan.length) return null;
    const ok = new Set(ch.orgOk ?? []); const done = new Set(ch.orgDone ?? []);
    const mk = (s: OrgStep): ReportMove => ({ id: s.id, n: s.n, c: s.c, from: s.from, to: s.to, fromId: bagIdByName(ch, s.from) ?? -1, toId: bagIdByName(ch, s.to) ?? -1 });
    const moves = plan.filter((s) => ok.has(s.i)).map(mk);
    const skipped = plan.filter((s) => done.has(s.i) && !ok.has(s.i)).map(mk);
    return moves.length || skipped.length ? { name: ch.name, assets: ch.assets, moves, skipped } : null;
  };

  const showReport = (rd: ReportData) => { setReport(rd); setLastReport(rd); };
  const reset = () => { setReport(null); watched.current.clear(); };

  // Pop a report when every watched organize is idle. Debounced so the final
  // orgOk/orgDone data settles (the sig changes as steps stream in).
  const sig = chars.map((c) => `${c.name}:${c.org?.active ? 1 : 0}:${c.orgOk?.length ?? 0}:${c.orgDone?.length ?? 0}`).join('|');
  useEffect(() => {
    const active = chars.filter((c) => c.org?.active).map((c) => c.name);
    for (const n of active) watched.current.add(n);
    if (active.length > 0 || watched.current.size === 0) return;
    const names = [...watched.current];
    const t = window.setTimeout(() => {
      const blocks: ReportBlock[] = [];
      for (const name of names) { const ch = chars.find((c) => c.name === name); if (ch) { const b = buildBlock(ch); if (b) blocks.push(b); } }
      watched.current.clear();
      if (blocks.length) showReport({ kind: 'organize', blocks });
    }, 800);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const title = opts?.title ?? (grouped ? 'Organize All' : targets.length === 1 ? `Organize ${targets[0].name}` : 'Organize');
  const nodes: ReactNode = (
    <>
      {rules && <OrganizePreviewModal targets={targets} rules={rules} layoutForChar={resolveLayout} iconSet={iconSet} grouped={grouped} title={title} onRun={run} onClose={closePreview} />}
      {report && <OperationReport report={report} onClose={() => setReport(null)} />}
    </>
  );

  return { openPreview, previewOpen: rules != null, nodes, showReport, reset, lastReport, showLastReport: () => { if (lastReport) setReport(lastReport); }, reportOpen: report != null, targetCount: targets.length };
}
