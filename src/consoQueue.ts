import { useSyncExternalStore } from 'react';
import { runConsolidateSelection, stopConsolidate, buildCappedBySender } from './consolidate';

export type ConsoJob = { key: string; itemId: number; itemName: string; assets?: string; recipient: string; amount: number };
export type ConsoQueueState = { jobs: ConsoJob[]; running: boolean; curKeys: string[]; done: string[] };

let jobs: ConsoJob[] = [];
let running = false;
let curKeys: string[] = [];
let done: string[] = [];
let stopped = false;
let seq = 0;

const subs = new Set<() => void>();
let snapshot: ConsoQueueState = { jobs, running, curKeys, done };
function notify() {
  snapshot = { jobs: [...jobs], running, curKeys: [...curKeys], done: [...done] };
  subs.forEach((s) => s());
}

export function useConsoQueue(): ConsoQueueState {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => snapshot, () => snapshot);
}

export function addConsoJob(job: Omit<ConsoJob, 'key'>) {
  const dup = jobs.find((j) => j.itemId === job.itemId && j.recipient === job.recipient);
  if (dup) { dup.amount = job.amount; notify(); return; }
  jobs.push({ ...job, key: `q${++seq}` });
  notify();
}
export function removeConsoJob(key: string) { if (running) return; jobs = jobs.filter((j) => j.key !== key); notify(); }
export function clearConsoQueue() { if (running) return; jobs = []; done = []; curKeys = []; notify(); }
export function stopConsoQueue() { stopped = true; stopConsolidate(); }

export async function runConsoQueue(experimental: boolean) {
  if (running || jobs.length === 0) return;
  running = true; stopped = false; done = []; notify();
  for (const job of [...jobs]) {
    if (stopped) break;
    curKeys = [job.key]; notify();
    try {
      await runConsolidateSelection(job.recipient, buildCappedBySender(job.recipient, job.itemId, job.amount, experimental), experimental);
    } catch { /* keep going through the queue */ }
    done.push(job.key); notify();
  }
  curKeys = []; running = false; notify();
}

export async function runConsoQueueFast(experimental: boolean) {
  if (running || jobs.length === 0) return;
  running = true; stopped = false; done = []; notify();
  const byRecipient = new Map<string, ConsoJob[]>();
  for (const j of jobs) { const arr = byRecipient.get(j.recipient) ?? []; arr.push(j); byRecipient.set(j.recipient, arr); }
  for (const [recipient, rjobs] of byRecipient) {
    if (stopped) break;
    curKeys = rjobs.map((j) => j.key); notify();
    const bySender: Record<string, Record<number, number>> = {};
    for (const j of rjobs) {
      const part = buildCappedBySender(recipient, j.itemId, j.amount, experimental);
      for (const sender in part) bySender[sender] = { ...(bySender[sender] ?? {}), ...part[sender] };
    }
    try {
      await runConsolidateSelection(recipient, bySender, experimental);
    } catch { /* keep going through the recipients */ }
    for (const j of rjobs) done.push(j.key);
    notify();
  }
  curKeys = []; running = false; notify();
}
