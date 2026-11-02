import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { MotionConfig, AnimatePresence, motion } from 'motion/react';
import { ItemHoverProvider } from './ItemTooltip';
import TitleBar from './TitleBar';
import NavRail, { type Section, GEARSETS_ENABLED } from './NavRail';
import { GlobalReforgeTracker } from './reforgeProgress';
import { useStickyChar, whenStickyLoaded, getStickyPersisted } from './sticky';
import { openPoolWindow, openGearsetWindow, toggleGearsetWindow, useGearsetOpen, GEARSET_OPEN_KEY } from './overlayWindow';
import { DistributeHost } from './distributeHost';
import { UseAllHost } from './useAllHost';
import { TextTipHost } from './textTip';
import { ErrorBoundary } from './ErrorBoundary';
import { useWallpaperBright, setWallpaperBright, usePanelOpacity, setPanelOpacity } from './wallpaper';
import { useTheme, THEMES } from './theme';
import { getMode, setMode, applyWindowSize, useMode, watchMaximized } from './windowSize';
import { getVersion } from '@tauri-apps/api/app';
import { checkForUpdate, checkAddonUpdate, installAll, readInstalledAddonVersion, type Update, type ManifestAddon } from './updater';
import { useAddonInfo, getManualAddonDir, setManualAddonDir, useKnownCharacters, removeChar, inTauri } from './bridge';
import { useAnon } from './anonymize';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useWatchAlerts } from './watch';
import { useDropSync, useDrop, setDrop } from './drop';
import { useShopSellSync } from './shop';
import { useFindColorsSync } from './findColors';
import { useBazaarDelaysSync } from './bazaarDelays';
import { FindColorsSettings } from './FindColorsSettings';
import { KeepBagsSettings } from './KeepBagsSettings';
import { useShopNpcSync } from './menuShortcuts';
import { usePoolRulesSync } from './poolRules';
import { usePoolAlert } from './poolAlerts';
import { usePoolPriceTee } from './poolPriceTee';
import { usePoolSageBridge } from './poolSageBridge';
import { useSettings, setSettings, useSettingsSync } from './settings';
import { setRowPollMinutes } from './priceStore';
import { useAutoOrganizeOnMog } from './autoOrganize';
import { usePullAutoRun } from './pullAutoRun';
import { initMovedTracker } from './movedTracker';
import { useResupplySync, useResupplyDone } from './resupply';
import { useVendorSync, useVendorDone } from './vendors';
import { useFindCacheSync } from './findCache';
import { useNavTo, clearNavTo } from './ahNav';
import { Group, Row, RowStacked, Segmented, Toggle, Select, Slider, Button } from './ui';
import UpdateBanner, { getStartupCheck, setStartupCheck } from './UpdateBanner';
import LinkBanner from './LinkBanner';
import WhatsNew from './WhatsNew';
import ListingToasts from './ListingToasts';
import InventoryView from './InventoryView';
import LibraryView from './LibraryView';
import RecentView from './RecentView';
import WatchView from './WatchView';
import DropView from './DropView';
import DuplicateView from './DuplicateView';
import KeyItemsView from './KeyItemsView';
import OrganizeView from './OrganizeView';
import TaggingView from './TaggingView';
import AutoSortSettings from './AutoSortSettings';
import PoolView from './PoolView';
import TradeView from './TradeView';
import SlipsView from './SlipsView';
import CurrencyView from './CurrencyView';
import AuctionView from './AuctionView';
import DeliveryView from './DeliveryView';
import ShopView from './ShopView';
import SellView from './SellView';
import NetworthView from './NetworthView';
import { GearsetLauncher } from './GearsetView';
import { deriveGearswapData } from './gearset/gearsetFiles';
import { ServerHealthRow } from './ServerHealth';
import { debugLogPath, setDebugView } from './debugLog';
import ResupplyView from './ResupplyView';
import VendorsView from './VendorsView';
import SparksView from './SparksView';
import StoreView from './StoreView';
import AugmentView from './AugmentView';
import ReforgeView from './ReforgeView';
import UnityView from './UnityView';
import BazaarView from './BazaarView';
import SequencesView from './SequencesView';
import CommandsView from './CommandsView';
import './alerts';

function DebugLogRow() {
  const [path, setPath] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => { void debugLogPath().then(setPath); }, []);
  const copy = async () => { try { await navigator.clipboard.writeText(path); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ } };
  return (
    <Row label="Debug Log" desc={path ? `Rolling diagnostic log (GPU, memory, frame timing, breadcrumbs) at: ${path}` : 'Rolling diagnostic log of GPU, memory, and frame timing, written to disk for crash diagnosis.'}>
      <Button variant="secondary" size="sm" onClick={copy} disabled={!path}>{copied ? 'Copied' : 'Copy Path'}</Button>
    </Row>
  );
}

function Placeholder({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="h-full grid place-items-center">
      <div className="text-center max-w-sm">
        <div className="text-[15px] font-bold text-fg mb-1">{title}</div>
        <div className="text-[12px] text-fg-4 leading-relaxed">{blurb}</div>
      </div>
    </div>
  );
}

function UpdatesSection() {
  const addon = useAddonInfo();
  const [version, setVersion] = useState('');
  const [status, setStatus] = useState<'idle' | 'checking' | 'none' | 'available' | 'installing' | 'installed' | 'error'>('idle');
  const [app, setApp] = useState<Update | null>(null);
  const [manifest, setManifest] = useState<ManifestAddon | null>(null);
  const [label, setLabel] = useState('');
  const [installedAddonVer, setInstalledAddonVer] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [startupChk, setStartupChk] = useState(getStartupCheck());
  const manual = getManualAddonDir();
  useEffect(() => { getVersion().then(setVersion).catch(() => {}); }, []);

  const addonVer = addon?.version ?? null;

  // One check for both; one install for both. The addon writes first, then the app relaunches.
  const check = async () => {
    setStatus('checking'); setMsg(''); setApp(null); setManifest(null);
    try {
      const u = await checkForUpdate();
      const r = await checkAddonUpdate(addon?.dir ?? null, addon?.version ?? null);
      const am = r.kind === 'available' ? r.manifest : null;
      if (r.kind === 'error') setMsg(r.message); // surface addon-side trouble without blocking the app update
      setApp(u); setManifest(am);
      setStatus(u || am ? 'available' : 'none');
    } catch (e) { setMsg(String(e)); setStatus('error'); }
  };
  const install = async () => {
    setStatus('installing'); setMsg(''); setLabel('');
    const addonArg = addon?.dir && manifest ? { dir: addon.dir, manifest } : null;
    try {
      const res = await installAll(app, addonArg, (phase, pct) => setLabel(phase === 'addon' ? 'Installing addon…' : pct === 0 ? 'Starting…' : `Downloading ${pct}%`));
      // Reached only when the app had no update (no relaunch): confirm the addon write + reload hint.
      if (!res.relaunched) { setInstalledAddonVer(res.addon?.installed_version ?? null); setApp(null); setManifest(null); setStatus('installed'); }
    } catch (e) { setMsg(String(e)); setStatus('error'); }
  };
  const pickFolder = async () => {
    setMsg('');
    const picked = await openDialog({ directory: true, multiple: false, title: 'Select the Alexandria addon folder' });
    if (typeof picked !== 'string') return;
    const ver = await readInstalledAddonVersion(picked);
    if (ver == null) { setManualAddonDir(null); setMsg('That folder has no Alexandria.lua. Pick your Windower addons/Alexandria folder.'); setStatus('error'); return; }
    setManualAddonDir(picked);
  };

  const availBits = [app ? `app v${app.version}` : '', manifest ? `addon v${manifest.version}` : ''].filter(Boolean).join(' + ');
  const note =
    status === 'installed' ? `Addon installed${installedAddonVer ? ` v${installedAddonVer}` : ''}. Reload in-game with //lua reload Alexandria`
      : status === 'error' ? (msg || 'Update check failed.')
        : status === 'installing' ? (label || 'Installing…')
          : status === 'available' ? `Update available: ${availBits}`
            : status === 'none' ? "You're on the latest version."
              : `App v${version || '…'}${addonVer ? ` · Addon v${addonVer}` : ''}`;

  return (
    <Group title="Updates">
      <Row label="Version" desc={note}>
        {status === 'available' ? (
          <button onClick={install} className="le-tap px-3 py-1.5 text-[12px] font-semibold rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors">Update</button>
        ) : (
          <button onClick={check} disabled={status === 'checking' || status === 'installing'} className="le-tap px-3 py-1.5 text-[12px] font-semibold rounded-md bg-surface-raised border border-line text-fg-2 hover:bg-surface-hover disabled:opacity-50 transition-colors">
            {status === 'checking' ? 'Checking…' : status === 'installing' ? (label || 'Installing…') : 'Check for Updates'}
          </button>
        )}
      </Row>
      <Row label="Addon Folder" desc={addon ? `${addon.dir}${addonVer ? ` (v${addonVer})` : ''}` : 'Set your Windower addons/Alexandria folder, or connect a character in-game.'}>
        {addon ? (
          <button onClick={() => manual ? setManualAddonDir(null) : void pickFolder()} className="le-tap px-3 py-1.5 text-[12px] font-semibold rounded-md bg-surface-raised border border-line text-fg-3 hover:text-fg hover:bg-surface-hover transition-colors">
            {manual ? 'Auto' : 'Change Folder'}
          </button>
        ) : (
          <button onClick={pickFolder} className="le-tap px-3 py-1.5 text-[12px] font-semibold rounded-md bg-surface-raised border border-line text-fg-2 hover:bg-surface-hover transition-colors">Set Folder</button>
        )}
      </Row>
      <Row label="Check On Startup" desc="Automatically check for app + addon updates when Alexandria launches">
        <Toggle on={startupChk} onChange={(v) => { setStartupChk(v); setStartupCheck(v); }} />
      </Row>
    </Group>
  );
}

const FREQ_OPTS = ['5', '10', '15', '30', '60'];

function CharactersSettings() {
  const known = useKnownCharacters();
  const anon = useAnon();
  const [confirm, setConfirm] = useState<string | null>(null);
  const chars = useMemo(
    () => [...known].sort((a, b) => (a.online === b.online ? a.name.localeCompare(b.name) : a.online ? -1 : 1)),
    [known],
  );
  if (chars.length === 0) return null;
  return (
    <Group title="Characters" right={<span className="text-[10px] text-fg-4 tabular-nums">{chars.length}</span>}>
      {chars.map((c) => (
        <Row
          key={c.name}
          label={<span className="flex items-center gap-2"><span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.online ? 'bg-emerald-400' : 'bg-fg-4'}`} />{anon(c.name)}</span>}
          desc={[c.main, c.sub].filter(Boolean).join('/') || undefined}
        >
          {c.online ? (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-400/80">Connected</span>
          ) : confirm === c.name ? (
            <span className="flex items-center gap-1.5">
              <button onClick={() => setConfirm(null)} className="px-2 py-1 text-[11px] font-semibold rounded-md border border-line bg-field text-fg-3 hover:text-fg-2 transition-colors">Cancel</button>
              <button onClick={() => { void removeChar(c.name); setConfirm(null); }} className="px-2 py-1 text-[11px] font-semibold rounded-md border border-red-500/40 bg-red-500/15 text-red-300 hover:bg-red-500/25 transition-colors">Remove</button>
            </span>
          ) : (
            <button onClick={() => setConfirm(c.name)} aria-label={`Remove ${c.name}`} className="le-tap grid place-items-center w-7 h-7 rounded-md text-fg-4 hover:text-red-300 hover:bg-red-500/10 transition-colors">
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" /><path d="M10 11v6M14 11v6" /></svg>
            </button>
          )}
        </Row>
      ))}
    </Group>
  );
}

type SettingsTab = 'appearance' | 'characters' | 'commands' | 'notifications' | 'updates';
function SettingsView({ tab }: { tab: SettingsTab }) {
  const winMode = useMode();
  const drop = useDrop();
  const settings = useSettings();
  const bright = useWallpaperBright();
  const gsAddon = useAddonInfo();
  const gsDerived = gsAddon?.dir ? deriveGearswapData(gsAddon.dir) : '';
  const gsEffective = settings.gearswapPath || gsDerived;
  const panelOp = usePanelOpacity();
  const [theme, setTheme] = useTheme();
  return (
    <div className="max-w-xl mx-auto p-5">
      {tab === 'appearance' && <>
      <Group title="Appearance">
        <Row label="Theme" desc="Alexandria is the default. Pick a palette to recolor the whole app.">
          <Select
            value={theme}
            onChange={(v) => setTheme(v as typeof theme)}
            options={THEMES.map((t) => t.id)}
            renderOption={(v) => THEMES.find((t) => t.id === v)?.label ?? 'Alexandria'}
          />
        </Row>
        <RowStacked label="Text Size" desc="Scales the text size of the entire app.">
          <Slider value={Math.round(settings.uiScale * 100)} min={80} max={175} step={5} format={(v) => `${v}%`} onChange={(v) => setSettings({ ...settings, uiScale: v / 100 })} />
        </RowStacked>
        <RowStacked label="Wallpaper Brightness" desc="Brightens or dims the background art">
          <Slider value={Math.round(bright * 100)} min={40} max={160} step={5} format={(v) => `${v}%`} onChange={(v) => setWallpaperBright(v / 100)} />
        </RowStacked>
        <RowStacked label="Panel Opacity" desc="Lower lets more of the background show through the panels">
          <Slider value={Math.round(panelOp * 100)} min={40} max={120} step={5} format={(v) => `${v}%`} onChange={(v) => setPanelOpacity(v / 100)} />
        </RowStacked>
        <Row label="Large Item Popups" desc="Opens item details at a larger size.">
          <Toggle on={settings.bigItemCard} onChange={(v) => setSettings({ ...settings, bigItemCard: v })} />
        </Row>
      </Group>
      <Group title="Window">
        <Row label="Size" desc="Changes form factor of the app.">
          <Segmented
            value={winMode}
            onChange={(v) => setMode(v)}
            options={[{ v: 'compact', label: 'Compact' }, { v: 'regular', label: 'Regular' }]}
          />
        </Row>
        <Row label="Resize Window In Library" desc="Opens Library at a larger size. Off keeps your window size.">
          <Toggle on={settings.libraryAutoResize} onChange={(v) => setSettings({ ...settings, libraryAutoResize: v })} />
        </Row>
      </Group>
      </>}
      {tab === 'characters' && <CharactersSettings />}
      {tab === 'commands' && <>
      <Group title="Behavior">
        <Row label="Itemizer Name Matching" desc="How the get / put / move / drop commands match item names.">
          <Segmented
            value={settings.itemizerMatch}
            onChange={(v) => setSettings({ ...settings, itemizerMatch: v as 'strict' | 'loose' })}
            options={[{ v: 'strict', label: 'Strict' }, { v: 'loose', label: 'Loose' }]}
          />
        </Row>
        <RowStacked label="Drop Speed" desc="Instant drops the whole list at once (Treasury-style). A delay paces them one at a time.">
          <Slider
            value={drop.dropDelay ?? 0}
            min={0}
            max={1}
            step={0.05}
            format={(v) => (v <= 0 ? 'Instant' : `${v.toFixed(2)}s`)}
            onChange={(v) => setDrop({ ...drop, dropDelay: v })}
          />
        </RowStacked>
        <RowStacked label="Auction Listing Delay" desc="Seconds between each auction-house listing when posting a batch. Lower is faster.">
          <Slider
            value={settings.ahListDelaySec}
            min={0.5}
            max={4}
            step={0.5}
            format={(v) => `${v.toFixed(1)}s / item`}
            onChange={(v) => setSettings({ ...settings, ahListDelaySec: v })}
          />
        </RowStacked>
      </Group>
      <KeepBagsSettings />
      <AutoSortSettings />
      </>}
      {tab === 'notifications' && <>
      <Group title="Confirmations">
        <Row label="Disable Confirmation For Drop">
          <Toggle on={!!drop.skipDropConfirm} onChange={(v) => setDrop({ ...drop, skipDropConfirm: v })} />
        </Row>
        <Row label="Disable Confirmation For Add To Drop List">
          <Toggle on={!!drop.skipAddConfirm} onChange={(v) => setDrop({ ...drop, skipAddConfirm: v })} />
        </Row>
        <Row label="Disable Confirmation For Sell">
          <Toggle on={!!settings.skipSellConfirm} onChange={(v) => setSettings({ ...settings, skipSellConfirm: v })} />
        </Row>
      </Group>
      <Group title="Notifications">
        <Row label="Low Supply Warning Frequency">
          <Select
            value={String(settings.watchFreqMin)}
            onChange={(v) => setSettings({ ...settings, watchFreqMin: Number(v) })}
            options={FREQ_OPTS}
            renderOption={(v) => `Every ${v} min`}
          />
        </Row>
        <Row label="Auto-Refresh Prices" desc="How often on-screen Wishlist and Browse prices re-check the auction house.">
          <div className="w-40">
            <Select
              value={String(settings.ahPollMin)}
              onChange={(v) => setSettings({ ...settings, ahPollMin: Number(v) })}
              options={['0', '5', '10', '15', '30', '60']}
              renderValue={(v) => (v === '0' ? 'Off' : v === '60' ? 'Every hour' : `Every ${v} min`)}
              renderOption={(v) => (v === '0' ? 'Off' : v === '60' ? 'Every hour' : `Every ${v} min`)}
              full
            />
          </div>
        </Row>
      </Group>
      <Group title="Silence Chat Messages">
        <Row label="Action Confirmations">
          <Toggle on={settings.silence.action} onChange={(v) => setSettings({ ...settings, silence: { ...settings.silence, action: v } })} />
        </Row>
        <Row label="Operation Progress">
          <Toggle on={settings.silence.progress} onChange={(v) => setSettings({ ...settings, silence: { ...settings.silence, progress: v } })} />
        </Row>
        <Row label="Errors & Warnings">
          <Toggle on={settings.silence.error} onChange={(v) => setSettings({ ...settings, silence: { ...settings.silence, error: v } })} />
        </Row>
      </Group>
      <FindColorsSettings />
      </>}
      {tab === 'updates' && <>
      <UpdatesSection />
      <Group title="DIAGNOSTICS">
        <Row
          label="Memory Logging"
          desc="Logs each connected character's memory usage to data/mem.txt every few minutes."
        >
          <Toggle on={settings.memLog} onChange={(v) => setSettings({ ...settings, memLog: v })} />
        </Row>
        <ServerHealthRow />
        <DebugLogRow />
      </Group>
      <Group title="GEARSWAP">
        <div className="px-3.5 py-3">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] text-fg-2 flex items-center gap-2">
                Data Folder
                {!settings.gearswapPath && gsDerived && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-accent/15 text-accent border border-accent/30">Auto</span>}
              </div>
              <div className={`text-[11px] mt-0.5 truncate font-mono ${gsEffective ? 'text-fg-3' : 'text-fg-4'}`}>{gsEffective || 'Not set'}</div>
            </div>
            <button
              onClick={async () => {
                const picked = await openDialog({ directory: true, multiple: false, title: 'Select your GearSwap data folder' });
                if (typeof picked === 'string') setSettings({ ...settings, gearswapPath: picked });
              }}
              className="shrink-0 px-3 py-1.5 text-[12px] font-semibold rounded-md border border-line bg-surface text-fg-2 hover:text-fg hover:border-accent/40 transition-colors"
            >Browse…</button>
            {settings.gearswapPath && (
              <button onClick={() => setSettings({ ...settings, gearswapPath: undefined })} className="shrink-0 px-2.5 py-1.5 text-[12px] rounded-md border border-line text-fg-4 hover:text-fg-2 transition-colors" title="Revert to the auto-detected folder">Reset</button>
            )}
          </div>
          <div className="text-[11px] text-fg-4 mt-2 leading-snug">Auto-detected next to the Alexandria addon. Used by the gear pull GearSwap-set option. Use <span className="text-fg-3">Browse</span> only if your GearSwap folder lives somewhere else.</div>
        </div>
      </Group>
      <Group title="EXPERIMENTAL FEATURES">
        <Row
          label={<span className="flex flex-wrap items-center gap-x-2">Enable Experimental Features <span className="text-[10px] font-bold text-red-300">(USE AT YOUR OWN RISK)</span></span>}
          desc="Removes the distance requirement on shops, storage NPCs, and augment NPCs, allowing you to interact with them from anywhere in the zone."
        >
          <Toggle on={settings.experimentalFeatures} onChange={(v) => setSettings({ ...settings, experimentalFeatures: v })} />
        </Row>
        <Row
          label="Bazaar All Items"
          desc="Removes every restriction on putting an item in your bazaar, including Ex items and items outside your main inventory."
        >
          <Toggle on={settings.bazaarAllItems} onChange={(v) => setSettings({ ...settings, bazaarAllItems: v })} />
        </Row>
      </Group>
      </>}
    </div>
  );
}

const VIEWS: Record<Section, ReactElement> = {
  inventory: <InventoryView />,
  library: <LibraryView />,
  recent: <RecentView />,
  watch: <WatchView />,
  drop: <DropView />,
  dupe: <DuplicateView />,
  keyitems: <KeyItemsView />,
  currency: <CurrencyView />,
  trade: <TradeView />,
  pool: <PoolView view="pool" />,
  lotlist: <PoolView view="lotlist" />,
  passlist: <PoolView view="passlist" />,
  pricelist: <PoolView view="pricelist" />,
  alertlist: <PoolView view="alertlist" />,
  shop: <ShopView />,
  selllist: <SellView />,
  resupply: <ResupplyView />,
  vendors: <VendorsView />,
  sparks: <SparksView />,
  store: <StoreView />,
  auction: <AuctionView />,
  networth: <NetworthView />,
  bazaar: <BazaarView />,
  delivery: <DeliveryView />,
  organize: <OrganizeView />,
  tags: <TaggingView />,
  sequences: <SequencesView />,
  commands: <CommandsView />,
  slips: <SlipsView />,
  gearsets: <GearsetLauncher />,
  ambuscade: <AugmentView view="ambuscade" />,
  skirmish: <AugmentView view="skirmish" />,
  reive: <AugmentView view="reive" />,
  geasfete: <AugmentView view="geasfete" />,
  reforge: <ReforgeView />,
  unity: <UnityView />,
  settings: <SettingsView tab="appearance" />,
  setchars: <SettingsView tab="characters" />,
  setcommands: <SettingsView tab="commands" />,
  setnotify: <SettingsView tab="notifications" />,
  setupdates: <SettingsView tab="updates" />,
};

export default function App() {
  const [section, setSection] = useState<Section>('inventory');
  const gearsetOpen = useGearsetOpen();
  const [, setActiveChar] = useStickyChar();
  const navTo = useNavTo();
  useWatchAlerts();
  useDropSync();
  useShopSellSync();
  useShopNpcSync();
  usePoolRulesSync();
  usePoolAlert();
  usePoolPriceTee();   // forward pool-item AH prices to Sage's overlay
  usePoolSageBridge(); // tee pool settings to Sage + apply its overlay's rule/drop/price-mode clicks
  useSettingsSync();
  useFindColorsSync();
  useBazaarDelaysSync();
  const ahPollMin = useSettings().ahPollMin;
  useEffect(() => { setRowPollMinutes(ahPollMin); }, [ahPollMin]);
  // Whole-UI text scaling for accessibility. CSS zoom scales layout + fonts and reflows
  // correctly in the webview; removing it restores 100%.
  const uiScale = useSettings().uiScale;
  useEffect(() => {
    const el = document.documentElement;
    if (uiScale && uiScale !== 1) el.style.setProperty('zoom', String(uiScale));
    else el.style.removeProperty('zoom');
  }, [uiScale]);
  useAutoOrganizeOnMog();
  usePullAutoRun();
  useResupplySync();
  useResupplyDone();
  useVendorSync();
  useVendorDone();
  useFindCacheSync();
  useEffect(() => { initMovedTracker(); }, []);
  // Reopen the treasure pool overlay on launch if it was open when the app last closed.
  useEffect(() => {
    if (!inTauri) return;
    let done = false;
    whenStickyLoaded(() => {
      if (done) return;
      done = true;
      if (getStickyPersisted('pool.overlay.wasopen', false)) void openPoolWindow();
      if (GEARSETS_ENABLED && getStickyPersisted(GEARSET_OPEN_KEY, false)) void openGearsetWindow();
    });
  }, []);
  useEffect(() => { void applyWindowSize(getMode()); }, []);
  useEffect(() => { let un = () => {}; void watchMaximized().then((u) => { un = u; }); return () => un(); }, []);
  useEffect(() => { if (navTo) { setSection(navTo); clearNavTo(); } }, [navTo]);
  // Stamp the diagnostic log with the current view on EVERY navigation, so a crash tail always says where the
  // user was -- not just on the Curio screen. Junior's freezes hit different views, so this is what tells us which.
  useEffect(() => { setDebugView(section); }, [section]);
  return (
    <MotionConfig reducedMotion="user">
      <ItemHoverProvider>
      <div className="le-bg" />
      <div className="fixed inset-0 flex flex-col text-fg-2">
        <TitleBar />
        <UpdateBanner />
        <LinkBanner />
        <WhatsNew />
        <div className="flex-1 min-h-0 flex">
          <NavRail active={section} gearsetOpen={gearsetOpen} onSelect={(s) => { if (s === 'gearsets') { void toggleGearsetWindow(); return; } setSection(s); }} />
          <main className="flex-1 min-h-0 overflow-y-auto">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={section}
                className="h-full"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              >
                <ErrorBoundary>{VIEWS[section]}</ErrorBoundary>
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
      <GlobalReforgeTracker hidden={section === 'reforge'} onOpen={(name) => { setActiveChar(name); setSection('reforge'); }} />
      <ListingToasts />
      <DistributeHost />
      <UseAllHost />
      <TextTipHost />
      </ItemHoverProvider>
    </MotionConfig>
  );
}
