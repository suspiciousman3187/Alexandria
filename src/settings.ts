import { invoke } from '@tauri-apps/api/core';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { appDataPath, inTauri, broadcastBoxCommand, useBoxes } from './bridge';

export type ChatSilence = { action: boolean; progress: boolean; error: boolean };
export type AppSettings = { watchFreqMin: number; silence: ChatSilence; recentHours: number; autoOrganizeOnMog: boolean; autoOrganizeDelaySec: number; experimentalFeatures: boolean; anonymizeNames: boolean; ahServer?: string };
const DEFAULTS: AppSettings = { watchFreqMin: 15, silence: { action: false, progress: false, error: false }, recentHours: 6, autoOrganizeOnMog: false, autoOrganizeDelaySec: 5, experimentalFeatures: false, anonymizeNames: false };

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
      cfg = { watchFreqMin: Number(p?.watchFreqMin) || DEFAULTS.watchFreqMin, silence: normSilence(p), recentHours: Number(p?.recentHours) || DEFAULTS.recentHours, autoOrganizeOnMog: !!p?.autoOrganizeOnMog, autoOrganizeDelaySec: Number(p?.autoOrganizeDelaySec) > 0 ? Number(p.autoOrganizeDelaySec) : DEFAULTS.autoOrganizeDelaySec, experimentalFeatures: !!p?.experimentalFeatures, anonymizeNames: !!p?.anonymizeNames, ahServer: typeof p?.ahServer === 'string' ? p.ahServer : undefined };
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
}
