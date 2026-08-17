import { invoke } from '@tauri-apps/api/core';
import { useSyncExternalStore } from 'react';
import { appDataPath, inTauri } from './bridge';
import { getItemValue } from './priceStore';

export type AlertRule = {
  key: string;
  id: number;
  n: string;
  stack: boolean;
  world: string;
  cond: 'below' | 'above';
  threshold: number;
  enabled: boolean;
  triggered: boolean;
  lastMedian?: number;
  lastCheck?: number;
};

export type FiredAlert = { key: string; n: string; world: string; cond: 'below' | 'above'; threshold: number; median: number; at: number };

let rules: AlertRule[] = [];
let fired: FiredAlert[] = [];
let loaded = false;
let saveT: number | null = null;
const subs = new Set<() => void>();
const firedSubs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());
const notifyFired = () => firedSubs.forEach((f) => f());

const ruleKey = (world: string, id: number, stack: boolean, cond: string, threshold: number) => `${world}|${id}|${stack ? 1 : 0}|${cond}|${threshold}`;

async function load() {
  if (loaded) return;
  loaded = true;
  if (!inTauri) return;
  try {
    const txt = await invoke<string>('read_text_file', { path: await appDataPath('ah_alerts.json') });
    const p = JSON.parse(txt);
    if (Array.isArray(p)) rules = p.filter((r) => r && typeof r.id === 'number' && typeof r.key === 'string');
  } catch { /* none saved */ }
  notify();
}
if (inTauri) void load();

function save() {
  if (!inTauri || saveT != null) return;
  saveT = window.setTimeout(async () => {
    saveT = null;
    try { await invoke('write_text_file', { path: await appDataPath('ah_alerts.json'), contents: JSON.stringify(rules) }); } catch { /* ignore */ }
  }, 1000);
}

export function getAlerts(): AlertRule[] { return rules; }

export function addAlert(a: { id: number; n: string; stack: boolean; world: string; cond: 'below' | 'above'; threshold: number }) {
  const key = ruleKey(a.world, a.id, a.stack, a.cond, a.threshold);
  if (rules.some((r) => r.key === key)) return;
  rules = [...rules, { ...a, key, enabled: true, triggered: false }];
  notify(); save();
}

export function removeAlert(key: string) {
  rules = rules.filter((r) => r.key !== key);
  notify(); save();
}

export function setAlertEnabled(key: string, enabled: boolean) {
  rules = rules.map((r) => (r.key === key ? { ...r, enabled } : r));
  notify(); save();
}

export function clearFired(key?: string) {
  fired = key ? fired.filter((f) => f.key !== key) : [];
  notifyFired();
}

export function useAlerts(): AlertRule[] {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => rules, () => rules);
}

export function useFiredAlerts(): FiredAlert[] {
  return useSyncExternalStore((cb) => { firedSubs.add(cb); return () => firedSubs.delete(cb); }, () => fired, () => fired);
}

async function tick() {
  const active = rules.filter((r) => r.enabled);
  for (const r of active) {
    const v = await getItemValue(r.world, r.id, r.stack);
    const median = v?.median;
    const at = Date.now();
    if (median == null || !Number.isFinite(median)) continue;
    rules = rules.map((x) => (x.key === r.key ? { ...x, lastMedian: median, lastCheck: at } : x));
    const meets = r.cond === 'below' ? median <= r.threshold : median >= r.threshold;
    if (meets && !r.triggered) {
      rules = rules.map((x) => (x.key === r.key ? { ...x, triggered: true } : x));
      fired = [{ key: r.key, n: r.n, world: r.world, cond: r.cond, threshold: r.threshold, median, at }, ...fired].slice(0, 50);
      notifyFired();
    } else if (!meets && r.triggered) {
      rules = rules.map((x) => (x.key === r.key ? { ...x, triggered: false } : x));
    }
  }
  notify(); save();
}

const POLL_MS = 15 * 60 * 1000;
let pollerStarted = false;

export function startAlertPoller() {
  if (pollerStarted || !inTauri) return;
  pollerStarted = true;
  window.setTimeout(() => { void tick(); }, 8000);
  window.setInterval(() => { void tick(); }, POLL_MS);
}
if (inTauri) startAlertPoller();
