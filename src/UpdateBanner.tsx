import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { checkForUpdate, checkAddonUpdate, installAll, type Update, type ManifestAddon } from './updater';
import { useAddonInfo } from './bridge';
import { Button } from './ui';

const STARTUP_KEY = 'alex_check_updates_startup';
const SKIP_APP_KEY = 'alex_skip_app_v';
const SKIP_ADDON_KEY = 'alex_skip_addon_v';

export function getStartupCheck(): boolean {
  if (typeof localStorage === 'undefined') return true;
  const v = localStorage.getItem(STARTUP_KEY);
  return v == null ? true : v === '1';
}
export function setStartupCheck(on: boolean): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STARTUP_KEY, on ? '1' : '0');
}

export default function UpdateBanner() {
  const addon = useAddonInfo();
  const [app, setApp] = useState<Update | null>(null);
  const [addonManifest, setAddonManifest] = useState<ManifestAddon | null>(null);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState('');
  const [addonDone, setAddonDone] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!getStartupCheck()) return;
    let cancelled = false;
    (async () => {
      try {
        const u = await checkForUpdate();
        if (!cancelled && u && localStorage.getItem(SKIP_APP_KEY) !== u.version) setApp(u);
      } catch { /* offline / no manifest: stay quiet on startup */ }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!getStartupCheck() || !addon?.dir) return;
    let cancelled = false;
    (async () => {
      const r = await checkAddonUpdate(addon.dir, null);
      if (!cancelled && r.kind === 'available' && localStorage.getItem(SKIP_ADDON_KEY) !== r.manifest.version) {
        setAddonManifest(r.manifest);
      }
    })();
    return () => { cancelled = true; };
  }, [addon?.dir, addon?.version]);

  // One click does both: the addon writes first (survives the relaunch), then the app downloads and
  // relaunches. If only the addon has an update there is no relaunch, so we show the reload hint.
  const update = async () => {
    setBusy(true); setErr('');
    let addonArg = addon?.dir && addonManifest ? { dir: addon.dir, manifest: addonManifest } : null;
    if (app && !addonArg && addon?.dir) {
      try {
        const r = await checkAddonUpdate(addon.dir, null);
        if (r.kind === 'available') addonArg = { dir: addon.dir, manifest: r.manifest };
      } catch { setErr(''); }
    }
    try {
      const res = await installAll(app, addonArg, (phase, pct) => {
        setLabel(phase === 'addon' ? 'Updating addon…' : pct === 0 ? 'Starting…' : `Downloading ${pct}%`);
      });
      if (!res.relaunched) { setAddonManifest(null); setApp(null); setAddonDone(true); setBusy(false); }
      // relaunched: process is being killed, leave the banner as-is.
    } catch (e) { setErr(String(e)); setBusy(false); }
  };
  const dismiss = () => {
    if (app) localStorage.setItem(SKIP_APP_KEY, app.version);
    if (addonManifest) localStorage.setItem(SKIP_ADDON_KEY, addonManifest.version);
    setApp(null); setAddonManifest(null);
  };

  const pending = !!app || !!addonManifest;
  if (!pending && !addonDone && !err) return null;

  const collapse = {
    initial: { height: 0, opacity: 0 },
    animate: { height: 'auto' as const, opacity: 1 },
    exit: { height: 0, opacity: 0 },
    transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const },
    className: 'overflow-hidden',
  };

  // Headline version: the app version leads when present (the addon rides along in the same click);
  // otherwise the addon version.
  const headVer = app?.version ?? addonManifest?.version ?? '';
  const both = !!app && !!addonManifest;

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      className="shrink-0 border-b border-accent/30 bg-accent/10 overflow-hidden"
    >
      <AnimatePresence initial={false}>
        {pending && (
          <motion.div key="pending" {...collapse}>
            <div className="flex items-center gap-3 px-4 py-2 text-[12px]">
              <svg viewBox="0 0 24 24" className="w-4 h-4 text-accent shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="M8 11l4 4 4-4" /><path d="M5 21h14" /></svg>
              <span className="text-fg-2">
                {app ? <>Alexandria <b className="text-fg">v{headVer}</b> is available{both ? ' (app + addon).' : '.'}</>
                  : <>Addon update <b className="text-fg">v{headVer}</b> is available.</>}
              </span>
              <div className="ml-auto flex items-center gap-2">
                {busy ? (
                  <span className="text-fg-3 text-[11px]">{label || 'Updating…'}</span>
                ) : (
                  <>
                    <Button variant="primary" size="sm" onClick={update}>Update</Button>
                    <Button variant="ghost" size="sm" onClick={dismiss}>Later</Button>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}
        {addonDone && (
          <motion.div key="done" {...collapse}>
            <div className="flex items-center gap-3 px-4 py-2 text-[12px]">
              <span className="text-emerald-300">Addon updated.</span>
              <span className="text-fg-3">Run <span className="text-fg-2 font-semibold">//lua reload Alexandria</span> in-game to apply.</span>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setAddonDone(false)}>Dismiss</Button>
            </div>
          </motion.div>
        )}
        {err && (
          <motion.div key="err" {...collapse}>
            <div className="flex items-center gap-3 px-4 py-2 text-[12px]">
              <span className="text-red-300 truncate">{err}</span>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setErr('')}>Dismiss</Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
