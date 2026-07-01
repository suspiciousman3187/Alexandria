import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { invoke } from '@tauri-apps/api/core';
import { inTauri } from './bridge';

export type { Update };

export const ADDON_MANIFEST_URL = 'https://gnosis-xi.com/alexandria/addon.json';

export async function checkForUpdate(): Promise<Update | null> {
  if (!inTauri) return null;
  return await check();
}

export async function installUpdate(update: Update, onProgress?: (pct: number) => void): Promise<void> {
  let total = 0;
  let got = 0;
  await update.downloadAndInstall((e) => {
    if (e.event === 'Started') {
      total = e.data.contentLength ?? 0;
    } else if (e.event === 'Progress') {
      got += e.data.chunkLength;
      if (total) onProgress?.(Math.min(100, Math.round((got / total) * 100)));
    } else if (e.event === 'Finished') {
      onProgress?.(100);
    }
  });
  await relaunch();
}

export interface ManifestAddon {
  version: string;
  url: string;
  sha256?: string;
  notes?: string;
}

export interface AddonInstallResult {
  installed_version: string;
  files_written: number;
  files_skipped: number;
  skipped_examples: string[];
  addon_dir: string;
}

export function isNewerSemver(latest: string, installed: string | null): boolean {
  if (!installed) return true;
  const a = latest.split('.').map((n) => parseInt(n, 10) || 0);
  const b = installed.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

export async function readInstalledAddonVersion(addonDir: string): Promise<string | null> {
  if (!inTauri) return null;
  try { return await invoke<string | null>('read_installed_addon_version', { addonDir }); } catch { return null; }
}

export type AddonCheck =
  | { kind: 'none'; installed: string | null }
  | { kind: 'available'; manifest: ManifestAddon; installed: string | null }
  | { kind: 'no-addon'; message: string }
  | { kind: 'error'; message: string };

export async function checkAddonUpdate(addonDir: string | null, installedVersion: string | null): Promise<AddonCheck> {
  if (!inTauri) return { kind: 'no-addon', message: 'Updates are only available in the desktop app.' };
  if (!addonDir) return { kind: 'no-addon', message: 'Connect a character in-game so Alexandria can locate the addon folder.' };
  try {
    const installed = installedVersion ?? (await readInstalledAddonVersion(addonDir));
    const resp = await fetch(ADDON_MANIFEST_URL, { cache: 'no-cache' });
    if (!resp.ok) throw new Error(`manifest fetch ${resp.status}`);
    const manifest = (await resp.json()) as { addon?: ManifestAddon };
    if (!manifest.addon || !manifest.addon.version || !manifest.addon.url) {
      return { kind: 'none', installed };
    }
    if (!isNewerSemver(manifest.addon.version, installed)) {
      return { kind: 'none', installed };
    }
    return { kind: 'available', manifest: manifest.addon, installed };
  } catch (e) {
    return { kind: 'error', message: String(e) };
  }
}

export async function installAddonUpdate(addonDir: string, manifest: ManifestAddon): Promise<AddonInstallResult> {
  return await invoke<AddonInstallResult>('install_addon_update', {
    addonDir,
    url: manifest.url,
    expectedSha256: manifest.sha256 ?? null,
  });
}
