import { invoke } from '@tauri-apps/api/core';
import { appDataPath, inTauri, DEFAULT_ORGANIZE_RULES, normalizeOrganizeRules, type OrganizeRules } from './bridge';

// Load the same organize rules the Organize view persists (organize_rules.json),
// falling back to the current preset, then the built-in defaults. Lets Library
// run Organize Now with exactly what the user configured.
export async function loadOrganizeRules(): Promise<OrganizeRules> {
  const def = () => normalizeOrganizeRules(DEFAULT_ORGANIZE_RULES);
  if (!inTauri) return def();
  try {
    const r = JSON.parse(await invoke<string>('read_text_file', { path: await appDataPath('organize_rules.json') })) as OrganizeRules;
    return normalizeOrganizeRules({ ...DEFAULT_ORGANIZE_RULES, ...r });
  } catch {
    try {
      const txt = await invoke<string>('read_text_file', { path: await appDataPath('organize_presets.json') });
      const s = JSON.parse(txt) as { current?: string; presets?: Record<string, OrganizeRules> };
      const r = s.presets && s.current ? s.presets[s.current] : undefined;
      if (r) return normalizeOrganizeRules({ ...DEFAULT_ORGANIZE_RULES, ...r });
    } catch { /* fresh */ }
    return def();
  }
}
