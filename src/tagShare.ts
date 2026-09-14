import { invoke } from '@tauri-apps/api/core';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { TAG_COLORS, type TagStore, type TagDef } from './itemTags';

// The shareable file Alexandria writes for item tags: the tag definitions + the per-item assignments
// (keyed by item id, which is universal across accounts, so a friend's import lands on the same items).
export function tagFileText(store: TagStore): string {
  return JSON.stringify({ alexandria_item_tags: 1, tags: store.tags, assign: store.assign }, null, 2) + '\n';
}

// Parse a shared tag file back into a TagStore, dropping anything malformed and any assignment that points
// at a tag the file doesn't define.
export function parseTagShare(txt: string): TagStore {
  const out: TagStore = { tags: [], assign: {} };
  let p: unknown;
  try { p = JSON.parse(txt.trim()); } catch { return out; }
  if (!p || typeof p !== 'object') return out;
  const o = p as { tags?: unknown; assign?: unknown };
  const valid = new Set<string>();
  if (Array.isArray(o.tags)) for (const t of o.tags as TagDef[]) {
    if (t && typeof t.id === 'string' && typeof t.name === 'string') {
      out.tags.push({ id: t.id, name: t.name, color: typeof t.color === 'string' ? t.color : TAG_COLORS[0] });
      valid.add(t.id);
    }
  }
  if (o.assign && typeof o.assign === 'object') {
    const a = o.assign as Record<string, unknown>;
    for (const k in a) {
      const id = Number(k); if (!Number.isInteger(id)) continue;
      const arr = Array.isArray(a[k]) ? (a[k] as unknown[]).filter((x): x is string => typeof x === 'string' && valid.has(x)) : [];
      if (arr.length) out.assign[id] = arr;
    }
  }
  return out;
}

// Prompt for a save location and write the current tags there. Returns the path, or null if cancelled.
export async function exportTags(store: TagStore): Promise<string | null> {
  const path = await saveDialog({ title: 'Export Item Tags', defaultPath: 'alexandria_item_tags.json', filters: [{ name: 'Item Tags', extensions: ['json'] }] });
  if (typeof path !== 'string') return null;
  await invoke('write_text_file', { path, contents: tagFileText(store) });
  return path;
}
