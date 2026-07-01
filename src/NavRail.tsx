import { useEffect, useRef, useState, type ReactElement } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Tip } from './ui';
import { openExternal } from './bridge';
import { useSettings } from './settings';

const DISCORD_URL = 'https://discord.com/invite/vSgYvdh8gT';

export type Section =
  | 'inventory' | 'recent' | 'watch' | 'drop' | 'dupe' | 'keyitems' | 'currency' | 'trade'
  | 'pool' | 'lotlist' | 'passlist'
  | 'shop' | 'selllist' | 'resupply' | 'auction' | 'bazaar' | 'delivery' | 'sparks'
  | 'organize' | 'sequences' | 'commands' | 'store'
  | 'slips' | 'ambuscade' | 'skirmish' | 'reive' | 'geasfete'
  | 'settings';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

const rulesIcon = (<svg viewBox="0 0 24 24" {...S}><path d="M10 6h10" /><path d="M10 12h10" /><path d="M10 18h10" /><path d="m4 6 1 1 2-2" /><path d="m4 12 1 1 2-2" /><path d="M4 18h.01" /></svg>);
const passIcon = (<svg viewBox="0 0 24 24" {...S}><circle cx="12" cy="12" r="9" /><path d="m6 6 12 12" /></svg>);
const cape = (<svg viewBox="0 0 24 24" {...S}><path d="M9.5 4.5a2.5 2.5 0 0 0 5 0" /><path d="M9.5 4.5C6.5 6.5 5 13 5 21l3.5-2 3.5 2 3.5-2 3.5 2c0-8-1.5-14.5-4.5-16.5" /></svg>);
const armor = (<svg viewBox="0 0 24 24" {...S}><path d="M4 6l4-3 4 2 4-2 4 3-1 6c-.5 3-3 5.5-7 7-4-1.5-6.5-4-7-7z" /><path d="M12 5v15" /><path d="M5 9h14" /></svg>);
const sword = (<svg viewBox="0 0 24 24" {...S}><path d="M14.5 17.5 L3 6 L3 3 L6 3 L17.5 14.5" /><path d="M13 19 L19 13" /><path d="M16 16 L20 20" /><path d="M19 21 L21 19" /></svg>);

const ICONS: Record<Section, ReactElement> = {
  inventory: (<svg viewBox="0 0 24 24" {...S}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" /><path d="M9 4v5" /><path d="M15 4v5" /></svg>),
  recent:    (<svg viewBox="0 0 24 24" {...S}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 8v4l3 2" /></svg>),
  watch:     (<svg viewBox="0 0 24 24" {...S}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>),
  drop:      (<svg viewBox="0 0 24 24" {...S}><path d="M4 7h16" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /><path d="m6 7 1 13h10l1-13" /></svg>),
  dupe:      (<svg viewBox="0 0 24 24" {...S}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>),
  keyitems:  (<svg viewBox="0 0 24 24" {...S}><circle cx="7.5" cy="15.5" r="4" /><path d="m10.5 12.5 8-8" /><path d="m16 5 3 3" /><path d="m13 8 2.5 2.5" /></svg>),
  currency:  (<svg viewBox="0 0 24 24" {...S}><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" /><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></svg>),
  trade:     (<svg viewBox="0 0 24 24" {...S}><path d="M7 7h13l-3-3" /><path d="M17 17H4l3 3" /></svg>),
  pool:      (<svg viewBox="0 0 24 24" {...S}><path d="M3 7l9-4 9 4-9 4-9-4z" /><path d="M3 12l9 4 9-4" /><path d="M3 17l9 4 9-4" /></svg>),
  lotlist:   rulesIcon,
  passlist:  passIcon,
  shop:      (<svg viewBox="0 0 24 24" {...S}><path d="M3 9 4.5 4h15L21 9" /><path d="M4 9h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" /><path d="M3 9a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 3 0" /><path d="M9 20v-5h6v5" /></svg>),
  auction:   (<svg viewBox="0 0 24 24" {...S}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><circle cx="7" cy="7" r="1.2" /></svg>),
  bazaar:    (<svg viewBox="0 0 24 24" {...S}><path d="M5 8h14l-1 4H6z" /><path d="M6 12v7h12v-7" /><path d="M9 8V5a3 3 0 0 1 6 0v3" /></svg>),
  delivery:  (<svg viewBox="0 0 24 24" {...S}><rect x="2" y="5" width="20" height="14" rx="2" /><path d="m2 7 10 6 10-6" /></svg>),
  sparks:    (<svg viewBox="0 0 24 24" {...S}><path d="M12 2l2.2 6.3L20 10l-5.8 1.7L12 18l-2.2-6.3L4 10l5.8-1.7z" /><path d="M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z" /></svg>),
  selllist:  (<svg viewBox="0 0 24 24" {...S}><path d="M4 6h10" /><path d="M4 12h10" /><path d="M4 18h6" /><path d="M16 15l3 3 3-5" /></svg>),
  resupply:  (<svg viewBox="0 0 24 24" {...S}><path d="M3 7h13l-2-2" /><path d="M21 17H8l2 2" /><path d="M16 11h4v4" /></svg>),
  organize:  (<svg viewBox="0 0 24 24" {...S}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>),
  sequences: (<svg viewBox="0 0 24 24" {...S}><path d="M8 6h12" /><path d="M8 12h12" /><path d="M8 18h12" /><path d="M3.5 6h.01" /><path d="M3.5 12h.01" /><path d="M3.5 18h.01" /></svg>),
  commands:  (<svg viewBox="0 0 24 24" {...S}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3" /><path d="M13 15h4" /></svg>),
  store:     (<svg viewBox="0 0 24 24" {...S}><path d="M3 9 4.5 4h15L21 9" /><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9" /><path d="M9 13h6" /><path d="M9 17h6" /></svg>),
  slips:     (<svg viewBox="0 0 24 24" {...S}><path d="M3 5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M15 3v5h5" /><path d="M8 13h8" /><path d="M8 17h5" /></svg>),
  ambuscade: cape,
  skirmish:  sword,
  reive:     cape,
  geasfete:  armor,
  settings:  (<svg viewBox="0 0 24 24" {...S}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.6 7a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H7a1.7 1.7 0 0 0 1-1.5V1a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V7a1.7 1.7 0 0 0 1.5 1H23a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>),
};

const LABELS: Record<Section, string> = {
  inventory: 'Inventory', recent: 'Recent Items', watch: 'Watch List', drop: 'Drop List', dupe: 'Dupe Find', keyitems: 'Key Items',
  currency: 'Currency', trade: 'Trade', pool: 'Pool', lotlist: 'Lot List', passlist: 'Pass List',
  shop: 'Shop', selllist: 'Sell List', resupply: 'Curio', auction: 'Auction', bazaar: 'Bazaar', delivery: 'Delivery', sparks: 'Sparks/Unity',
  organize: 'Organize', sequences: 'Sequences', commands: 'Commands', store: 'Storage NPC',
  slips: 'Storage Slips', ambuscade: 'Ambuscade', skirmish: 'Skirmish', reive: 'Reive', geasfete: 'Geas Fete',
  settings: 'Settings',
};

const EXPERIMENTAL: Partial<Record<Section, boolean>> = { bazaar: true, ambuscade: true, reive: true, skirmish: true, geasfete: true, store: true, sparks: true };
const TOGGLE_EXPERIMENTAL = new Set<Section>(['ambuscade', 'reive', 'skirmish', 'geasfete', 'store', 'bazaar', 'sparks']);

const GROUP_ICON = {
  market: (<svg viewBox="0 0 24 24" {...S}><path d="M6 8h12l-1 12H7z" /><path d="M9 8a3 3 0 0 1 6 0" /></svg>),
  tools:  (<svg viewBox="0 0 24 24" {...S}><path d="M5 21v-6" /><path d="M5 11V3" /><path d="M12 21v-9" /><path d="M12 8V3" /><path d="M19 21v-4" /><path d="M19 13V3" /><path d="M2 15h6" /><path d="M9 8h6" /><path d="M16 17h6" /></svg>),
};

type NavGroup = { id: string; label: string; icon: ReactElement; primary?: Section; children: Section[] };
const GROUPS: NavGroup[] = [
  { id: 'inventory', label: 'Inventory', icon: ICONS.inventory, primary: 'inventory', children: ['recent', 'keyitems', 'currency', 'watch', 'drop'] },
  { id: 'pool', label: 'Pool', icon: ICONS.pool, primary: 'pool', children: ['lotlist', 'passlist'] },
  { id: 'market', label: 'Market', icon: GROUP_ICON.market, primary: 'auction', children: ['delivery', 'bazaar', 'shop', 'selllist'] },
  { id: 'tools', label: 'Tools', icon: GROUP_ICON.tools, primary: 'organize', children: ['store', 'slips', 'resupply', 'sparks'] },
  { id: 'augment', label: 'Augment', icon: armor, primary: 'ambuscade', children: ['reive', 'skirmish', 'geasfete'] },
];

const railBtn = 'le-tap group relative w-[60px] h-[58px] @max-[460px]:w-11 @max-[460px]:h-11 rounded-xl flex flex-col items-center justify-center gap-1 transition-colors';

function RailButton({ id, label, icon, active, onSelect }: { id: Section; label: string; icon: ReactElement; active: boolean; onSelect: (s: Section) => void }) {
  return (
    <button onClick={() => onSelect(id)} aria-label={label} className={`${railBtn} ${active ? 'text-on-accent' : 'text-fg-3 hover:bg-line hover:text-fg'}`}>
      {active && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-xl bg-[var(--color-nav-active)]" transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }} />}
      <span className="relative z-[1] w-5 h-5">{icon}</span>
      <span className="relative z-[1] text-[10px] font-semibold tracking-wide @max-[460px]:hidden">{label}</span>
      <Tip label={label} compactOnly />
    </button>
  );
}

function GroupItem({ group, active, onSelect }: { group: NavGroup; active: Section; onSelect: (s: Section) => void }) {
  const exp = useSettings().experimentalFeatures;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const kids = group.children;
  const groupActive = group.primary === active || kids.includes(active);

  const go = (s: Section) => { onSelect(s); setOpen(false); };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={ref} className="relative w-full flex justify-center">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={group.label}
        aria-expanded={open}
        className={`${railBtn} ${groupActive ? 'text-on-accent' : 'text-fg-3 hover:bg-line hover:text-fg'}`}
      >
        {groupActive && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-xl bg-[var(--color-nav-active)]" transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }} />}
        <span className="relative z-[1] w-5 h-5">{group.icon}</span>
        <span className="relative z-[1] text-[10px] font-semibold tracking-wide @max-[460px]:hidden">{group.label}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -6 }}
            transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
            className="absolute left-full top-0 ml-2 z-50 min-w-[208px] rounded-xl border border-line bg-popover shadow-xl p-2 flex flex-col gap-1"
          >
            <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-fg-4">{group.label}</div>
            {(group.primary ? [group.primary, ...kids] : kids).map((s) => (
              <button key={s} onClick={() => go(s)} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-[13px] font-semibold transition-colors ${active === s ? 'bg-[var(--color-nav-active)] text-on-accent' : 'text-fg-2 hover:bg-line hover:text-fg'}`}>
                <span className="w-[18px] h-[18px] shrink-0">{ICONS[s]}</span><span className="whitespace-nowrap">{LABELS[s]}</span>
                {EXPERIMENTAL[s] && (!TOGGLE_EXPERIMENTAL.has(s) || exp) && <span className="ml-auto shrink-0 whitespace-nowrap px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-amber-500/15 text-amber-300 border border-amber-500/30">Experimental</span>}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function NavRail({ active, onSelect }: { active: Section; onSelect: (s: Section) => void }) {
  return (
    <nav className="bg-nav relative z-40 w-[76px] @max-[460px]:w-14 shrink-0 h-full flex flex-col items-center gap-1 py-3 border-r border-line">
      {GROUPS.map((g) => <GroupItem key={g.id} group={g} active={active} onSelect={onSelect} />)}

      <div className="mt-auto w-full flex flex-col items-center gap-1 pt-1 border-t border-line">
        <RailButton id="settings" label={LABELS.settings} icon={ICONS.settings} active={active === 'settings'} onSelect={onSelect} />
        <button
          onClick={() => openExternal(DISCORD_URL)}
          aria-label="Discord"
          className="group relative w-[60px] h-[58px] @max-[460px]:w-11 @max-[460px]:h-11 rounded-xl flex flex-col items-center justify-center gap-1 text-fg-3 hover:text-indigo-300 hover:bg-indigo-500/10 transition-colors"
        >
          <span className="w-5 h-5">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full" aria-hidden>
              <path d="M20.317 4.369a19.79 19.79 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.009c.12.099.246.198.373.292a.077.077 0 01-.006.127 12.3 12.3 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
            </svg>
          </span>
          <span className="text-[10px] font-semibold tracking-wide @max-[460px]:hidden">Discord</span>
          <Tip label="Discord" compactOnly />
        </button>
      </div>
    </nav>
  );
}
