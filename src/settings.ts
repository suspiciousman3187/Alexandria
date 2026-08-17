import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { appDataPath, inTauri, broadcastBoxCommand, sendBoxCommand, useBoxes } from './bridge';

export type ChatSilence = { action: boolean; progress: boolean; error: boolean };
export type AppSettings = { watchFreqMin: number; silence: ChatSilence; recentHours: number; autoOrganizeOnMog: boolean; autoOrganizeDelaySec: number; experimentalFeatures: boolean; anonymizeNames: boolean; memLog: boolean; ahServer?: string; gearswapPath?: string; ahPollMin: number; sparksDelaySec: number; autoSortBags: number[]; autoSortExclude: string[]; skipSellConfirm: boolean; uiScale: number; libraryAutoResize: boolean; bigItemCard: boolean };
const DEFAULTS: AppSettings = { watchFreqMin: 15, silence: { action: false, progress: false, error: false }, recentHours: 6, autoOrganizeOnMog: false, autoOrganizeDelaySec: 5, experimentalFeatures: false, anonymizeNames: false, memLog: false, ahPollMin: 15, sparksDelaySec: 0, autoSortBags: [], autoSortExclude: [], skipSellConfirm: false, uiScale: 1, libraryAutoResize: true, bigItemCard: false };

function normSilence(p: Record<string, unknown> | undefined): ChatSilence {
  const s = p?.silence as Record<string, unknown> | undefined;
  if (s && typeof s === 'object') return { action: !!s.action, progress: !!s.progress, error: !!s.error };
  // Migrate the old single "silence all" toggle.
  const all = !!p?.silenceChat;
  return { action: all, progress: all, error: all };
}

let cfg: AppSettings = { ...DEFAULTS };
let started = false;
let ready = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((s) => s());

async function load() {
  if (started) return;
  started = true;
  if (inTauri) {
    try {
      const txt = await invoke<string>('read_text_file', { path: await appDataPath('app_settings.json') });
      const p = JSON.parse(txt);
      cfg = { watchFreqMin: Number(p?.watchFreqMin) || DEFAULTS.watchFreqMin, silence: normSilence(p), recentHours: Number(p?.recentHours) || DEFAULTS.recentHours, autoOrganizeOnMog: !!p?.autoOrganizeOnMog, autoOrganizeDelaySec: Number(p?.autoOrganizeDelaySec) > 0 ? Number(p.autoOrganizeDelaySec) : DEFAULTS.autoOrganizeDelaySec, experimentalFeatures: !!p?.experimentalFeatures, anonymizeNames: !!p?.anonymizeNames, memLog: !!p?.memLog, ahServer: typeof p?.ahServer === 'string' ? p.ahServer : undefined, gearswapPath: typeof p?.gearswapPath === 'string' ? p.gearswapPath : undefined, ahPollMin: typeof p?.ahPollMin === 'number' && p.ahPollMin >= 0 ? p.ahPollMin : DEFAULTS.ahPollMin, sparksDelaySec: typeof p?.sparksDelaySec === 'number' && p.sparksDelaySec >= 0 ? p.sparksDelaySec : DEFAULTS.sparksDelaySec, autoSortBags: Array.isArray(p?.autoSortBags) ? p.autoSortBags.filter((n: unknown): n is number => typeof n === 'number') : DEFAULTS.autoSortBags, autoSortExclude: Array.isArray(p?.autoSortExclude) ? p.autoSortExclude.filter((n: unknown): n is string => typeof n === 'string') : DEFAULTS.autoSortExclude, skipSellConfirm: !!p?.skipSellConfirm, uiScale: typeof p?.uiScale === 'number' && p.uiScale >= 0.5 && p.uiScale <= 3 ? p.uiScale : DEFAULTS.uiScale, libraryAutoResize: p?.libraryAutoResize !== false, bigItemCard: !!p?.bigItemCard };
    } catch { /* none saved — keep defaults */ }
  }
  ready = true;
  cfg = { ...cfg };
  notify();
}
if (inTauri) void load(); else ready = true;

async function save() {
  if (!inTauri) return;
  try { await invoke('write_text_file', { path: await appDataPath('app_settings.json'), contents: JSON.stringify(cfg) }); } catch { /* ignore */ }
}

export function getSettings() { return cfg; }
export function setSettings(next: AppSettings) { cfg = next; notify(); void save(); }

export function useSettings(): AppSettings {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => cfg, () => cfg);
}

export function useSettingsSync() {
  const boxes = useBoxes();
  const c = useSettings();
  const onlineKey = useMemo(() => boxes.map((b) => b.conn).sort((a, b) => a - b).join(','), [boxes]);
  useEffect(() => {
    if (!ready) return;
    void broadcastBoxCommand(JSON.stringify({ cmd: 'silence', action: c.silence.action, progress: c.silence.progress, error: c.silence.error }));
  }, [c.silence.action, c.silence.progress, c.silence.error, onlineKey]);
  useEffect(() => {
    if (!ready) return;
    void broadcastBoxCommand(JSON.stringify({ cmd: 'experimental', on: c.experimentalFeatures }));
  }, [c.experimentalFeatures, onlineKey]);
  useEffect(() => {
    if (!ready) return;
    void broadcastBoxCommand(JSON.stringify({ cmd: 'memlog', on: c.memLog }));
  }, [c.memLog, onlineKey]);
  useEffect(() => {
    if (!ready) return;
    const excl = new Set(c.autoSortExclude);
    for (const b of boxes) {
      if (b.conn == null) continue;
      sendBoxCommand(b.conn, JSON.stringify({ cmd: 'autosort', bags: excl.has(b.name) ? [] : c.autoSortBags }));
    }
  }, [c.autoSortBags, c.autoSortExclude, onlineKey]);
}
