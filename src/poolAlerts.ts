import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { appDataPath, inTauri, useKnownCharacters } from './bridge';

// Audible watch: a global list of item names. When any connected character's treasure pool holds a matching
// item, the app repeats a tone until the item leaves the pool (lotted/passed/dropped) or the user dismisses
// it. Names (not ids) match the rest of the pool-rule system, and the list is party-wide (the pool is), so
// you arm "Volte" once, not per character.

// ---- persisted config -------------------------------------------------------------------------------
let names: string[] = [];
let on = true;
let volume = 0.6;
let started = false;
let ready = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

const SYNC_KEY = 'alexandria:poolalerts:sync';

async function load() {
  if (started) return;
  started = true;
  if (inTauri) {
    try {
      const txt = await invoke<string>('read_text_file', { path: await appDataPath('pool_alerts.json') });
      const p = JSON.parse(txt) as Record<string, unknown>;
      if (Array.isArray(p.names)) names = p.names.filter((x): x is string => typeof x === 'string');
      on = p.on !== false; // default ON
      if (typeof p.volume === 'number' && p.volume >= 0 && p.volume <= 1) volume = p.volume;
    } catch { /* none saved */ }
  }
  ready = true;
  notify();
}
if (inTauri) void load(); else ready = true;

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== SYNC_KEY || !e.newValue) return;
    try {
      const p = JSON.parse(e.newValue) as { names?: string[]; on?: boolean; volume?: number };
      if (Array.isArray(p.names)) names = p.names.filter((x): x is string => typeof x === 'string');
      on = p.on !== false;
      if (typeof p.volume === 'number') volume = p.volume;
      ready = true;
      notify();
    } catch { /* ignore */ }
  });
}

async function save() {
  if (!inTauri) return;
  try { await invoke('write_text_file', { path: await appDataPath('pool_alerts.json'), contents: JSON.stringify({ names, on, volume }) }); } catch { /* ignore */ }
  try { localStorage.setItem(SYNC_KEY, JSON.stringify({ names, on, volume, t: Date.now() })); } catch { /* ignore */ }
}

const sub = (cb: () => void) => { subs.add(cb); return () => subs.delete(cb); };

export function useAlertNames(): string[] { return useSyncExternalStore(sub, () => names, () => names); }
export function setAlertNames(v: string[]) { names = v; notify(); void save(); }
export function hasAlert(name: string): boolean { const lc = name.toLowerCase(); return names.some((x) => x.toLowerCase() === lc); }
export function toggleAlert(name: string) {
  const lc = name.toLowerCase();
  names = names.some((x) => x.toLowerCase() === lc) ? names.filter((x) => x.toLowerCase() !== lc) : [...names, name];
  notify(); void save();
}
export function useAlertOn(): boolean { return useSyncExternalStore(sub, () => on, () => on); }
export function setAlertOn(v: boolean) { on = v; notify(); void save(); }
export function useAlertVolume(): number { return useSyncExternalStore(sub, () => volume, () => volume); }
export function setAlertVolume(v: number) { volume = Math.max(0, Math.min(1, v)); notify(); void save(); }

// ---- runtime: which watched items are sounding right now, + dismiss ---------------------------------
let activeNames: string[] = [];
let dismissed = new Set<string>(); // pool-entry keys (id:ts) the user silenced until they leave
export function useAlertActiveNames(): string[] { return useSyncExternalStore(sub, () => activeNames, () => activeNames); }
export function dismissAlerts() { dismissed = new Set(lastPresentKeys); recompute(); }

let lastPresentKeys = new Set<string>();
let lastPresentNames = new Map<string, string>(); // key -> display name
function recompute() {
  // prune dismissed keys that have left the pool, so a fresh drop (new ts) re-alerts
  for (const k of [...dismissed]) if (!lastPresentKeys.has(k)) dismissed.delete(k);
  const live = [...lastPresentKeys].filter((k) => !dismissed.has(k));
  const nm = [...new Set(live.map((k) => lastPresentNames.get(k) ?? '').filter(Boolean))];
  const changed = nm.length !== activeNames.length || nm.some((x, i) => x !== activeNames[i]);
  if (changed) { activeNames = nm; notify(); }
  if (on && live.length > 0) startTone(volume); else stopTone();
}

// ---- sound: Web Audio repeating beep (no bundled asset) ---------------------------------------------
let ctx: AudioContext | null = null;
let toneTimer: number | null = null;
function beep(vol: number) {
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime;
    [880, 1175, 1568].forEach((f, i) => {
      const o = ctx!.createOscillator(), g = ctx!.createGain();
      o.type = 'sine'; o.frequency.value = f;
      const t = t0 + i * 0.16;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      o.connect(g); g.connect(ctx!.destination);
      o.start(t); o.stop(t + 0.17);
    });
  } catch { /* audio unavailable */ }
}
function startTone(vol: number) { if (toneTimer != null) return; beep(vol); toneTimer = window.setInterval(() => beep(vol), 2500); }
function stopTone() { if (toneTimer != null) { clearInterval(toneTimer); toneTimer = null; } }
export function testAlertTone() { beep(volume); }

// ---- the watcher: mount ONCE (main window) ----------------------------------------------------------
export function usePoolAlert() {
  const chars = useKnownCharacters();
  const nm = useAlertNames();
  const enabled = useAlertOn();
  const vol = useAlertVolume();
  const nameSet = useMemo(() => new Set(nm.map((n) => n.toLowerCase())), [nm]);

  // Signature of the watched entries currently in any pool, so the effect only reruns on a real change.
  const present = useMemo(() => {
    const keys = new Map<string, string>();
    if (enabled && nameSet.size > 0) {
      for (const c of chars) {
        if (!c.online) continue;
        for (const it of c.pool ?? []) if (nameSet.has(it.n.toLowerCase())) keys.set(`${it.id}:${it.ts}`, it.n);
      }
    }
    return keys;
  }, [chars, nameSet, enabled]);
  const sig = useMemo(() => [...present.keys()].sort().join('|'), [present]);

  useEffect(() => {
    lastPresentKeys = new Set(present.keys());
    lastPresentNames = present;
    recompute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, enabled, vol]);

  useEffect(() => () => stopTone(), []);
}
