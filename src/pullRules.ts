import { invoke } from '@tauri-apps/api/core';
import { useSyncExternalStore } from 'react';
import { appDataPath, inTauri } from './bridge';

// A saved "Pull" preset: move items carrying any of `tags`, sitting in one of `bags`, into inventory.
// When `jobOnly` is on, only pieces the active character's current job can equip are pulled.
// slips: pull from Porter slips at all. slipSids: specific slip item-ids to use (empty = all owned slips).
// autoGetSlips: when a needed slip isn't in your bags, fetch it into inventory first (needs its storage reachable).
// dest: ordered destination bags to pull INTO (fill the first with room, then fall back). Empty = inventory only.
// autoOnJobChange: when the character changes job while they can reach BOTH the Porter Moogle and a
// job-change Moogle (i.e. Mog Garden / a Mog House with the Porter in range), run this pull automatically.
// jobs: when autoOnJobChange is on, restrict the auto-run to these main jobs (empty/undefined = any job).
export type PullRule = { id: string; name: string; tags: string[]; bags: number[]; jobOnly: boolean; slips?: boolean; slipSids?: number[]; autoGetSlips?: boolean; dest?: number[]; autoOnJobChange?: boolean; jobs?: string[] };

let rules: PullRule[] = [];
let started = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

async function load() {
  if (started) return;
  started = true;
  if (!inTauri) return;
  try {
    const txt = await invoke<string>('read_text_file', { path: await appDataPath('pull_rules.json') });
    const p = JSON.parse(txt);
    if (Array.isArray(p)) {
      rules = p.filter((r) => r && typeof r.id === 'string').map((r) => ({
        id: String(r.id), name: String(r.name || 'Pull'),
        tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
        bags: Array.isArray(r.bags) ? r.bags.map(Number).filter((n: number) => Number.isFinite(n)) : [],
        jobOnly: !!r.jobOnly, slips: !!r.slips,
        slipSids: Array.isArray(r.slipSids) ? r.slipSids.map(Number).filter((n: number) => Number.isFinite(n)) : undefined,
        autoGetSlips: !!r.autoGetSlips,
        dest: Array.isArray(r.dest) ? r.dest.map(Number).filter((n: number) => Number.isFinite(n)) : undefined,
        autoOnJobChange: !!r.autoOnJobChange,
        jobs: Array.isArray(r.jobs) ? r.jobs.map(String) : undefined,
      }));
      notify();
    }
  } catch { /* none saved */ }
}
if (inTauri) void load();

async function save() {
  if (!inTauri) return;
  try { await invoke('write_text_file', { path: await appDataPath('pull_rules.json'), contents: JSON.stringify(rules) }); } catch { /* ignore */ }
}

export function getPullRules(): PullRule[] { return rules; }
export function setPullRules(next: PullRule[]) { rules = next; notify(); void save(); }
export function usePullRules(): PullRule[] {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => rules, () => rules);
}
export function newPullId(): string { return 'pr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
