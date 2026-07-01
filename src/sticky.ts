import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { appDataPath, inTauri } from './bridge';

const store = new Map<string, unknown>();

export function useSticky<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [v, setV] = useState<T>(() => (store.has(key) ? (store.get(key) as T) : initial));
  const set = useCallback<Dispatch<SetStateAction<T>>>((action) => {
    setV((prev) => {
      const next = typeof action === 'function' ? (action as (p: T) => T)(prev) : action;
      store.set(key, next);
      return next;
    });
  }, [key]);
  return [v, set];
}

let activeChar: string | null = null;

export function useStickyChar(): [string | null, Dispatch<SetStateAction<string | null>>] {
  const [v, setV] = useState<string | null>(activeChar);
  const set = useCallback<Dispatch<SetStateAction<string | null>>>((action) => {
    setV((prev) => {
      const next = typeof action === 'function' ? (action as (p: string | null) => string | null)(prev) : action;
      activeChar = next;
      return next;
    });
  }, []);
  return [v, set];
}

const FILE = 'ui_sticky.json';
const persisted = new Map<string, unknown>();
const touched = new Set<string>();
const loadSubs = new Set<() => void>();
let persistLoaded = false;

async function loadPersisted() {
  if (persistLoaded || !inTauri) { persistLoaded = true; return; }
  try {
    const txt = await invoke<string>('read_text_file', { path: await appDataPath(FILE) });
    const obj = JSON.parse(txt);
    if (obj && typeof obj === 'object') for (const [k, val] of Object.entries(obj)) persisted.set(k, val);
  } catch { /* none yet */ }
  persistLoaded = true;
  loadSubs.forEach((f) => f());
}
void loadPersisted();

let saveTimer: number | undefined;
function schedulePersistSave() {
  if (!inTauri) return;
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    const obj: Record<string, unknown> = {};
    for (const [k, val] of persisted) obj[k] = val;
    try { await invoke('write_text_file', { path: await appDataPath(FILE), contents: JSON.stringify(obj) }); } catch { /* ignore */ }
  }, 400);
}

export function getStickyPersisted<T>(key: string, fallback: T): T {
  return persisted.has(key) ? (persisted.get(key) as T) : fallback;
}

export function useStickyPersisted<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [v, setV] = useState<T>(() => (persisted.has(key) ? (persisted.get(key) as T) : initial));
  useEffect(() => {
    if (persistLoaded) { if (!touched.has(key) && persisted.has(key)) setV(persisted.get(key) as T); return; }
    const sync = () => { if (!touched.has(key) && persisted.has(key)) setV(persisted.get(key) as T); };
    loadSubs.add(sync);
    return () => { loadSubs.delete(sync); };
  }, [key]);
  const set = useCallback<Dispatch<SetStateAction<T>>>((action) => {
    setV((prev) => {
      const next = typeof action === 'function' ? (action as (p: T) => T)(prev) : action;
      touched.add(key);
      persisted.set(key, next);
      schedulePersistSave();
      return next;
    });
  }, [key]);
  return [v, set];
}
