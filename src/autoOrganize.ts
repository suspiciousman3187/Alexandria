import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useBoxes, runOrganize, appDataPath, inTauri, type OrganizeRules } from './bridge';
import { useSettings } from './settings';

async function readCurrentRules(): Promise<OrganizeRules | null> {
  if (!inTauri) return null;
  try {
    const txt = await invoke<string>('read_text_file', { path: await appDataPath('organize_presets.json') });
    const p = JSON.parse(txt) as { current?: string; presets?: Record<string, OrganizeRules> };
    if (p?.presets && p.current && p.presets[p.current]) return p.presets[p.current];
  } catch { /* no presets saved */ }
  return null;
}

export function useAutoOrganizeOnMog() {
  const boxes = useBoxes();
  const settings = useSettings();
  const enabled = settings.autoOrganizeOnMog;
  const delayMs = Math.max(1, settings.autoOrganizeDelaySec) * 1000;
  const prevMog = useRef<Map<number, boolean>>(new Map());
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const boxesRef = useRef(boxes);
  boxesRef.current = boxes;

  useEffect(() => {
    const seen = new Set<number>();
    for (const b of boxes) {
      const conn = b.conn;
      if (conn == null) continue;
      seen.add(conn);
      const was = prevMog.current.get(conn) ?? false;
      const now = !!b.mog;
      prevMog.current.set(conn, now);

      if (enabled && now && !was && !timers.current.has(conn)) {
        const t = setTimeout(() => {
          timers.current.delete(conn);
          const live = boxesRef.current.find((x) => x.conn === conn);
          if (!live || !live.mog) return; // left the mog house before the delay elapsed
          void readCurrentRules().then((rules) => { if (rules) runOrganize(conn, rules); });
        }, delayMs);
        timers.current.set(conn, t);
      } else if (!now && timers.current.has(conn)) {
        clearTimeout(timers.current.get(conn)!);
        timers.current.delete(conn);
      }
    }
    // Drop tracking for characters that disconnected.
    for (const conn of [...prevMog.current.keys()]) {
      if (!seen.has(conn)) {
        prevMog.current.delete(conn);
        const t = timers.current.get(conn);
        if (t) { clearTimeout(t); timers.current.delete(conn); }
      }
    }
  }, [boxes, enabled, delayMs]);

  useEffect(() => {
    const t = timers.current;
    return () => { for (const h of t.values()) clearTimeout(h); };
  }, []);
}
