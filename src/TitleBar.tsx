import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Tip } from './ui';

const win = () => getCurrentWindow();
const ONTOP_KEY = 'alexandria-ontop';

function WinButton({ label, tip, onClick, danger }: { label: string; tip: string; onClick?: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-label={tip}
      className={`group relative grid place-items-center w-11 h-9 text-fg-3 transition-colors ${
        danger ? 'hover:bg-red-600 hover:text-white' : 'hover:bg-line hover:text-fg'
      }`}
    >
      <span className="text-[13px] leading-none">{label}</span>
      <Tip label={tip} side="bottom" />
    </button>
  );
}

function PinButton() {
  const [on, setOn] = useState(() => { try { return localStorage.getItem(ONTOP_KEY) === '1'; } catch { return false; } });
  useEffect(() => { void win().setAlwaysOnTop(on); }, [on]);
  const toggle = () => {
    const next = !on;
    setOn(next);
    try { localStorage.setItem(ONTOP_KEY, next ? '1' : '0'); } catch { /* ignore */ }
  };
  return (
    <button
      onClick={toggle}
      aria-label="Always on top"
      aria-pressed={on}
      className={`group relative grid place-items-center w-11 h-9 transition-colors ${on ? 'bg-accent text-on-accent' : 'text-fg-3 hover:bg-line hover:text-fg'}`}
    >
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 17v5" /><path d="M15 9.34V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v3.34a2 2 0 0 1-.78 1.58L6 12.34V14h12v-1.66l-2.22-1.42A2 2 0 0 1 15 9.34Z" /></svg>
      <Tip label="Always on top" side="bottom" />
    </button>
  );
}

export default function TitleBar() {
  return (
    <header
      data-tauri-drag-region
      className="h-9 shrink-0 flex items-center bg-nav border-b border-line select-none pl-3"
    >
      <div className="flex items-center gap-2 pointer-events-none">
        <span className="w-[3px] h-3.5 rounded bg-accent" />
        <span className="text-[11px] font-extrabold tracking-[0.18em] text-accent">ALEXANDRIA</span>
        <span className="text-[9px] font-extrabold tracking-[0.12em] text-amber-300 border border-amber-400/50 bg-amber-400/10 rounded px-1 py-px leading-none">BETA</span>
        <span className="text-[10px] text-fg-4 font-medium">v0.0.1</span>
      </div>
      <div className="ml-auto flex items-center">
        <PinButton />
        <WinButton label="—" tip="Minimize" onClick={() => void win().minimize()} />
        <WinButton label="▢" tip="Maximize" onClick={() => void win().toggleMaximize()} />
        <WinButton label="✕" tip="Close" danger onClick={() => void win().close()} />
      </div>
    </header>
  );
}
