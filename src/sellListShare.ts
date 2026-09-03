import { invoke } from '@tauri-apps/api/core';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';

// Parse a shared sell-list file into a de-duplicated list of item names. Accepts either the JSON that
// Alexandria exports ({ items: [...] } or a bare array) or a plain newline-separated list, so a hand-made
// or pasted list still imports cleanly.
export function parseSellList(txt: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (n: unknown) => {
    if (typeof n !== 'string') return;
    const name = n.trim().replace(/^[-*]\s+/, ''); // tolerate "- Name" bullet lines
    if (!name) return;
    const k = name.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(name);
  };
  const trimmed = txt.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const p: unknown = JSON.parse(trimmed);
      const arr = Array.isArray(p)
        ? p
        : (p && typeof p === 'object' && Array.isArray((p as { items?: unknown }).items)) ? (p as { items: unknown[] }).items : null;
      if (arr) { for (const n of arr) push(n); return out; }
    } catch { /* not JSON -- fall through to line parsing */ }
  }
  for (const line of trimmed.split(/\r?\n/)) push(line);
  return out;
}

// The shareable file Alexandria writes: a small JSON wrapper around the list of names.
export function sellListFileText(items: string[]): string {
  return JSON.stringify({ alexandria_sell_list: 1, items }, null, 2) + '\n';
}

// Prompt for a save location and write the current sell list there. Returns the path written, or null if
// the user cancelled the save dialog.
export async function exportSellList(items: string[]): Promise<string | null> {
  const path = await saveDialog({ title: 'Export Sell List', defaultPath: 'alexandria_sell_list.json', filters: [{ name: 'Sell List', extensions: ['json', 'txt'] }] });
  if (typeof path !== 'string') return null;
  await invoke('write_text_file', { path, contents: sellListFileText(items) });
  return path;
}
