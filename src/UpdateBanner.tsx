import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { checkForUpdate, installUpdate, checkAddonUpdate, installAddonUpdate, type Update, type ManifestAddon } from './updater';
import { useAddonInfo } from './bridge';

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
  const [installing, setInstalling] = useState<'app' | 'addon' | null>(null);
  const [appPct, setAppPct] = useState<number | null>(null);
  const [addonDone, setAddonDone] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!getStartupCheck()) return;
    let cancelled = false;
    (async () => {
      try {
        const u = await checkForUpdate();
        if (!cancelled && u && localStorage.getItem(SKIP_APP_KEY) !== u.version) setApp(u);
      } catch { /* offline / no manifest — stay quiet on startup */ }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!getStartupCheck() || !addon?.dir) return;
    let cancelled = false;
    (async () => {
      const r = await checkAddonUpdate(addon.dir, addon.version);
      if (!cancelled && r.kind === 'available' && localStorage.getItem(SKIP_ADDON_KEY) !== r.manifest.version) {
        setAddonManifest(r.manifest);
      }
    })();
    return () => { cancelled = true; };
  }, [addon?.dir, addon?.version]);

  const installApp = async () => {
    if (!app) return;
    setInstalling('app'); setErr(''); setAppPct(0);
    try { await installUpdate(app, setAppPct); } catch (e) { setErr(String(e)); setInstalling(null); }
  };
  const installAddon = async () => {
    if (!addon?.dir || !addonManifest) return;
    setInstalling('addon'); setErr('');
    try { await installAddonUpdate(addon.dir, addonManifest); setAddonManifest(null); setAddonDone(true); }
    catch (e) { setErr(String(e)); }
    finally { setInstalling(null); }
  };
  const skipApp = () => { if (app) localStorage.setItem(SKIP_APP_KEY, app.version); setApp(null); };
  const skipAddon = () => { if (addonManifest) localStorage.setItem(SKIP_ADDON_KEY, addonManifest.version); setAddonManifest(null); };

  if (!app && !addonManifest && !addonDone && !err) return null;

  const collapse = {
    initial: { height: 0, opacity: 0 },
    animate: { height: 'auto' as const, opacity: 1 },
    exit: { height: 0, opacity: 0 },
    transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const },
    className: 'overflow-hidden',
  };

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      className="shrink-0 border-b border-accent/30 bg-accent/10 overflow-hidden"
    >
      <AnimatePresence initial={false}>
        {app && (
          <motion.div key="app" {...collapse}>
            <Line
              text={<>Alexandria <b className="text-fg">v{app.version}</b> is available.</>}
              busy={installing === 'app'}
              busyLabel={appPct == null ? 'Starting…' : `Downloading ${appPct}%`}
              onInstall={installApp}
              onDismiss={skipApp}
              disabled={installing !== null}
            />
          </motion.div>
        )}
        {addonManifest && (
          <motion.div key="addon" {...collapse}>
            <Line
              text={<>Addon update <b className="text-fg">v{addonManifest.version}</b> is available.</>}
              busy={installing === 'addon'}
              busyLabel="Installing…"
              onInstall={installAddon}
              onDismiss={skipAddon}
              disabled={installing !== null}
            />
          </motion.div>
        )}
        {addonDone && (
          <motion.div key="done" {...collapse}>
            <div className="flex items-center gap-3 px-4 py-2 text-[12px]">
              <span className="text-emerald-300">Addon updated.</span>
              <span className="text-fg-3">Run <span className="text-fg-2 font-semibold">//lua reload Alexandria</span> in-game to apply.</span>
              <button onClick={() => setAddonDone(false)} className="ml-auto text-fg-4 hover:text-fg text-[11px] px-2 py-1">Dismiss</button>
            </div>
          </motion.div>
        )}
        {err && (
          <motion.div key="err" {...collapse}>
            <div className="flex items-center gap-3 px-4 py-2 text-[12px]">
              <span className="text-red-300 truncate">{err}</span>
              <button onClick={() => setErr('')} className="ml-auto text-fg-4 hover:text-fg text-[11px] px-2 py-1">Dismiss</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function Line({ text, busy, busyLabel, onInstall, onDismiss, disabled }: {
  text: React.ReactNode; busy: boolean; busyLabel: string; onInstall: () => void; onDismiss: () => void; disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 text-[12px]">
      <svg viewBox="0 0 24 24" className="w-4 h-4 text-accent shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="M8 11l4 4 4-4" /><path d="M5 21h14" /></svg>
      <span className="text-fg-2">{text}</span>
      <div className="ml-auto flex items-center gap-2">
        {busy ? (
          <span className="text-fg-3 text-[11px]">{busyLabel}</span>
        ) : (
          <>
            <button onClick={onInstall} disabled={disabled} className="px-3 py-1 text-[11px] font-semibold rounded-md bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-50 transition-colors">Install</button>
            <button onClick={onDismiss} disabled={disabled} className="px-2 py-1 text-[11px] font-semibold rounded-md text-fg-3 hover:text-fg-2 disabled:opacity-50 transition-colors">Later</button>
          </>
        )}
      </div>
    </div>
  );
}
