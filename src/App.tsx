import { useEffect, useState, type ReactElement } from 'react';
import { MotionConfig, AnimatePresence, motion } from 'motion/react';
import { ItemHoverProvider } from './ItemTooltip';
import TitleBar from './TitleBar';
import NavRail, { type Section } from './NavRail';
import { useWallpaperBright, setWallpaperBright, usePanelOpacity, setPanelOpacity } from './wallpaper';
import { useTheme, THEMES } from './theme';
import { getMode, setMode, applyWindowSize, useMode, watchMaximized } from './windowSize';
import { getVersion } from '@tauri-apps/api/app';
import { checkForUpdate, installUpdate, checkAddonUpdate, installAddonUpdate, type Update, type ManifestAddon, type AddonInstallResult } from './updater';
import { useAddonInfo } from './bridge';
import { useWatchAlerts } from './watch';
import { useDropSync, useDrop, setDrop } from './drop';
import { useShopSellSync } from './shop';
import { useShopNpcSync } from './menuShortcuts';
import { usePoolRulesSync } from './poolRules';
import { useSettings, setSettings, useSettingsSync } from './settings';
import { useAutoOrganizeOnMog } from './autoOrganize';
import { useResupplySync } from './resupply';
import { useNavTo, clearNavTo } from './ahNav';
import { Group, Row, RowStacked, Segmented, Toggle, Select, Slider } from './ui';
import UpdateBanner, { getStartupCheck, setStartupCheck } from './UpdateBanner';
import ListingToasts from './ListingToasts';
import InventoryView from './InventoryView';
import RecentView from './RecentView';
import WatchView from './WatchView';
import DropView from './DropView';
import DuplicateView from './DuplicateView';
import KeyItemsView from './KeyItemsView';
import OrganizeView from './OrganizeView';
import PoolView from './PoolView';
import TradeView from './TradeView';
import SlipsView from './SlipsView';
import CurrencyView from './CurrencyView';
import AuctionView from './AuctionView';
import DeliveryView from './DeliveryView';
import ShopView from './ShopView';
import SellView from './SellView';
import ResupplyView from './ResupplyView';
import SparksView from './SparksView';
import StoreView from './StoreView';
import AugmentView from './AugmentView';
import BazaarView from './BazaarView';
import SequencesView from './SequencesView';
import CommandsView from './CommandsView';

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
  const [version, setVersion] = useState('');
  const [status, setStatus] = useState<'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'error'>('idle');
  const [update, setUpdate] = useState<Update | null>(null);
  const [pct, setPct] = useState(0);
  const [msg, setMsg] = useState('');
  const [startupChk, setStartupChk] = useState(getStartupCheck());
  useEffect(() => { getVersion().then(setVersion).catch(() => {}); }, []);

  const check = async () => {
    setStatus('checking'); setMsg('');
    try { const u = await checkForUpdate(); if (u) { setUpdate(u); setStatus('available'); } else setStatus('none'); }
    catch (e) { setMsg(String(e)); setStatus('error'); }
  };
  const install = async () => {
    if (!update) return;
    setStatus('downloading'); setPct(0);
    try { await installUpdate(update, setPct); } catch (e) { setMsg(String(e)); setStatus('error'); }
  };

  const note =
    status === 'none' ? "You're on the latest version."
      : status === 'available' ? `Update available: v${update?.version}`
        : status === 'error' ? (msg || 'Update check failed.')
          : status === 'downloading' ? `Downloading… ${pct}%`
            : version ? `v${version}` : '';

  return (
    <Group title="Updates">
      <Row label="App Version" desc={note}>
        {status === 'available' ? (
          <button onClick={install} className="px-3 py-1.5 text-[12px] font-semibold rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors">Install</button>
        ) : (
          <button onClick={check} disabled={status === 'checking' || status === 'downloading'} className="px-3 py-1.5 text-[12px] font-semibold rounded-md bg-surface-raised border border-line text-fg-2 hover:bg-surface-hover disabled:opacity-50 transition-colors">
            {status === 'checking' ? 'Checking…' : status === 'downloading' ? `${pct}%` : 'Check for Updates'}
          </button>
        )}
      </Row>
      <AddonUpdateRow />
      <Row label="Check On Startup" desc="Automatically check for app + addon updates when Alexandria launches">
        <Toggle on={startupChk} onChange={(v) => { setStartupChk(v); setStartupCheck(v); }} />
      </Row>
    </Group>
  );
}

function AddonUpdateRow() {
  const addon = useAddonInfo();
  const [status, setStatus] = useState<'idle' | 'checking' | 'none' | 'available' | 'installing' | 'installed' | 'error'>('idle');
  const [manifest, setManifest] = useState<ManifestAddon | null>(null);
  const [result, setResult] = useState<AddonInstallResult | null>(null);
  const [msg, setMsg] = useState('');

  const installed = addon?.version ?? null;

  const check = async () => {
    setStatus('checking'); setMsg('');
    const r = await checkAddonUpdate(addon?.dir ?? null, installed);
    if (r.kind === 'available') { setManifest(r.manifest); setStatus('available'); }
    else if (r.kind === 'none') setStatus('none');
    else { setMsg(r.message); setStatus('error'); }
  };
  const install = async () => {
    if (!addon?.dir || !manifest) return;
    setStatus('installing'); setMsg('');
    try { const res = await installAddonUpdate(addon.dir, manifest); setResult(res); setStatus('installed'); }
    catch (e) { setMsg(String(e)); setStatus('error'); }
  };

  const note =
    !addon ? 'Connect a character in-game to enable addon updates.'
      : status === 'none' ? `Addon is up to date${installed ? ` (v${installed})` : ''}.`
        : status === 'available' ? `Addon update available: v${manifest?.version}`
          : status === 'installing' ? 'Installing addon…'
            : status === 'installed' ? `Installed v${result?.installed_version} — reload in-game with //lua reload Alexandria`
              : status === 'error' ? (msg || 'Addon update check failed.')
                : installed ? `v${installed}` : 'Addon detected';

  return (
    <Row label="Addon Version" desc={note}>
      {status === 'available' ? (
        <button onClick={install} className="px-3 py-1.5 text-[12px] font-semibold rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors">Install</button>
      ) : (
        <button onClick={check} disabled={!addon || status === 'checking' || status === 'installing'} className="px-3 py-1.5 text-[12px] font-semibold rounded-md bg-surface-raised border border-line text-fg-2 hover:bg-surface-hover disabled:opacity-50 transition-colors">
          {status === 'checking' ? 'Checking…' : status === 'installing' ? 'Installing…' : 'Check for Updates'}
        </button>
      )}
    </Row>
  );
}

const FREQ_OPTS = ['5', '10', '15', '30', '60'];

function SettingsView() {
  const winMode = useMode();
  const drop = useDrop();
  const settings = useSettings();
  const bright = useWallpaperBright();
  const panelOp = usePanelOpacity();
  const [theme, setTheme] = useTheme();
  return (
    <div className="max-w-xl mx-auto p-5">
      <Group title="Appearance">
        <Row label="Theme" desc="Alexandria is the default. Pick a palette to recolor the whole app.">
          <Select
            value={theme}
            onChange={(v) => setTheme(v as typeof theme)}
            options={THEMES.map((t) => t.id)}
            renderOption={(v) => THEMES.find((t) => t.id === v)?.label ?? 'Alexandria'}
          />
        </Row>
        <RowStacked label="Wallpaper Brightness" desc="Brightens or dims the background art">
          <Slider value={Math.round(bright * 100)} min={40} max={160} step={5} format={(v) => `${v}%`} onChange={(v) => setWallpaperBright(v / 100)} />
        </RowStacked>
        <RowStacked label="Panel Opacity" desc="Lower lets more of the background show through the panels">
          <Slider value={Math.round(panelOp * 100)} min={40} max={120} step={5} format={(v) => `${v}%`} onChange={(v) => setPanelOpacity(v / 100)} />
        </RowStacked>
      </Group>
      <Group title="Window">
        <Row label="Size" desc="Changes form factor of the app.">
          <Segmented
            value={winMode}
            onChange={(v) => setMode(v)}
            options={[{ v: 'compact', label: 'Compact' }, { v: 'regular', label: 'Regular' }]}
          />
        </Row>
      </Group>
      <Group title="Behavior">
        <Row label="Disable Confirmation For Drop">
          <Toggle on={!!drop.skipDropConfirm} onChange={(v) => setDrop({ ...drop, skipDropConfirm: v })} />
        </Row>
        <Row label="Disable Confirmation For Add To Drop List">
          <Toggle on={!!drop.skipAddConfirm} onChange={(v) => setDrop({ ...drop, skipAddConfirm: v })} />
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
      <UpdatesSection />
      <Group title="EXPERIMENTAL FEATURES">
        <Row
          label={<span className="flex flex-wrap items-center gap-x-2">Enable Experimental Features <span className="text-[10px] font-bold text-red-300">(USE AT YOUR OWN RISK)</span></span>}
          desc="Removes the distance requirement on shops, storage NPCs, and augment NPCs, allowing you to interact with them from anywhere in the zone."
        >
          <Toggle on={settings.experimentalFeatures} onChange={(v) => setSettings({ ...settings, experimentalFeatures: v })} />
        </Row>
      </Group>
    </div>
  );
}

const VIEWS: Record<Section, ReactElement> = {
  inventory: <InventoryView />,
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
  shop: <ShopView />,
  selllist: <SellView />,
  resupply: <ResupplyView />,
  sparks: <SparksView />,
  store: <StoreView />,
  auction: <AuctionView />,
  bazaar: <BazaarView />,
  delivery: <DeliveryView />,
  organize: <OrganizeView />,
  sequences: <SequencesView />,
  commands: <CommandsView />,
  slips: <SlipsView />,
  ambuscade: <AugmentView view="ambuscade" />,
  skirmish: <AugmentView view="skirmish" />,
  reive: <AugmentView view="reive" />,
  geasfete: <AugmentView view="geasfete" />,
  settings: <SettingsView />,
};

export default function App() {
  const [section, setSection] = useState<Section>('inventory');
  const navTo = useNavTo();
  useWatchAlerts();
  useDropSync();
  useShopSellSync();
  useShopNpcSync();
  usePoolRulesSync();
  useSettingsSync();
  useAutoOrganizeOnMog();
  useResupplySync();
  useEffect(() => { void applyWindowSize(getMode()); }, []);
  useEffect(() => { let un = () => {}; void watchMaximized().then((u) => { un = u; }); return () => un(); }, []);
  useEffect(() => { if (navTo) { setSection(navTo); clearNavTo(); } }, [navTo]);
  return (
    <MotionConfig reducedMotion="user">
      <ItemHoverProvider>
      <div className="le-bg" />
      <div className="fixed inset-0 flex flex-col text-fg-2">
        <TitleBar />
        <UpdateBanner />
        <div className="flex-1 min-h-0 flex">
          <NavRail active={section} onSelect={setSection} />
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
                {VIEWS[section]}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
      <ListingToasts />
      </ItemHoverProvider>
    </MotionConfig>
  );
}
