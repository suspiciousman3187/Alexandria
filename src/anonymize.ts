import { useSettings } from './settings';

// Display-only anonymization: real names stay in keys/equality/wire payloads; each character maps to a stable "Player N" by first-seen order.
const map = new Map<string, number>();
let next = 1;

function idFor(name: string): number {
  const key = name.toLowerCase();
  let n = map.get(key);
  if (n == null) { n = next; next += 1; map.set(key, n); }
  return n;
}

export function anonName(name: string | undefined | null, on: boolean): string {
  if (!name) return name ?? '';
  return on ? `Player ${idFor(name)}` : name;
}

export function useAnon(): (name?: string | null) => string {
  const on = !!useSettings().anonymizeNames;
  return (name) => anonName(name, on);
}
