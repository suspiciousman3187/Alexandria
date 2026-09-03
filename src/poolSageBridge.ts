import { useEffect, useMemo, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { inTauri, useKnownCharacters } from './bridge';
import { useDrop, setDrop } from './drop';
import { usePoolStore, addRuleToChars, removeRuleFromChar } from './poolRules';
import { usePoolPriceMode, usePoolPriceDefault, setPoolPriceMode, type PriceMode } from './poolPriceMode';

// Sage's overlay is a pure display + relay; Alexandria owns every pool setting. This bridge is the two-way
// glue for the overlay's per-item ... menu:
//   * TEES Alexandria's current settings state to Sage for DISPLAY -- the drop list, the price-display mode,
//     and each online character's auto-lot/pass rule lists (t:"poolsettings").
//   * RECEIVES the overlay's ... clicks (relayed by Sage's host, surfaced as the "sage-command" Tauri event)
//     and applies each to Alexandria's OWN stores, which then re-tee. Sage never owns any of it.
// Call once at app root (a no-op when Sage isn't running -- sage_send just queues to a dead socket).
export function usePoolSageBridge() {
  const known = useKnownCharacters();
  const drop = useDrop();
  const rules = usePoolStore();
  const priceMode = usePoolPriceMode();
  const priceDefault = usePoolPriceDefault();

  const onlineNames = useMemo(() => known.filter((c) => c.online).map((c) => c.name), [known]);

  // --- Tee the settings state up to Sage (only when it actually changes) ---
  const settings = useMemo(() => ({
    drop: drop.drop,
    priceDefault,
    priceMode,
    rules: Object.fromEntries(onlineNames.map((n) => [n, { lot: rules[n]?.lot ?? [], pass: rules[n]?.pass ?? [] }])),
  }), [drop.drop, priceDefault, priceMode, rules, onlineNames]);
  const sig = JSON.stringify(settings);
  useEffect(() => {
    if (!inTauri) return;
    void invoke('sage_send', { line: JSON.stringify({ t: 'poolsettings', ...settings }) }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  // --- Apply the overlay's ... clicks to Alexandria's stores ---
  const dropRef = useRef(drop);
  dropRef.current = drop;
  const namesRef = useRef(onlineNames);
  namesRef.current = onlineNames;
  const defRef = useRef(priceDefault);
  defRef.current = priceDefault;
  useEffect(() => {
    if (!inTauri) return;
    const un = listen<string>('sage-command', (e) => {
      let m: { cmd?: string; name?: string; on?: boolean; char?: string; kind?: string; id?: number; mode?: string };
      try { m = JSON.parse(e.payload); } catch { return; }
      if (m.cmd === 'pooldrop' && typeof m.name === 'string') {
        const cur = dropRef.current;
        const has = cur.drop.some((n) => n.toLowerCase() === m.name!.toLowerCase());
        if (m.on && !has) setDrop({ ...cur, drop: [...cur.drop, m.name] });
        else if (!m.on && has) setDrop({ ...cur, drop: cur.drop.filter((n) => n.toLowerCase() !== m.name!.toLowerCase()) });
      } else if (m.cmd === 'poolrule' && typeof m.name === 'string' && (m.kind === 'lot' || m.kind === 'pass')) {
        const targets = m.char === '*' ? namesRef.current : m.char ? [m.char] : [];
        if (m.on) addRuleToChars(targets, m.kind, m.name);
        else for (const t of targets) removeRuleFromChar(t, m.kind, m.name);
      } else if (m.cmd === 'poolpricemode' && typeof m.id === 'number' && (m.mode === 'single' || m.mode === 'stack')) {
        const mode = m.mode as PriceMode;
        setPoolPriceMode(m.id, mode === defRef.current ? null : mode);
      }
    });
    return () => { void un.then((f) => f()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
