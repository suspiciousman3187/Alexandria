import { useState, useRef, useEffect, useId, type ReactNode, type CSSProperties, type InputHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { bagColor } from './bagColors';
import { useAnon } from './anonymize';

// Text/search input with a built-in clear (×) button that appears once there's text.
// `wrap` styles the relative container (layout); `className` styles the input (visual).
export function SearchInput({ value, onChange, className = '', wrap = 'flex-1 min-w-0', ...rest }:
  { value: string; onChange: (v: string) => void; className?: string; wrap?: string }
  & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'className'>) {
  return (
    <div className={`relative ${wrap}`}>
      <input {...rest} value={value} onChange={(e) => onChange(e.target.value)} className={`w-full ${className}${value ? ' pr-8' : ''}`} />
      {value && (
        <button type="button" onClick={() => onChange('')} aria-label="Clear" className="absolute right-1.5 top-1/2 -translate-y-1/2 grid place-items-center w-5 h-5 rounded text-fg-4 hover:text-fg-2 hover:bg-line transition-colors">
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><path d="M6 6 18 18M18 6 6 18" /></svg>
        </button>
      )}
    </div>
  );
}

// Bag identity tag: a per-bag color-coded label so bag origin is scannable wherever
// items from multiple bags are shown together.
export function BagTag({ id, label, className = '' }: { id: number | undefined; label: string; className?: string }) {
  const c = bagColor(id);
  return (
    <span className={`shrink-0 inline-flex items-center gap-1 truncate rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-none ${c.pill} ${className}`}>
      <span className={`w-1 h-1 rounded-full shrink-0 ${c.dot}`} />
      <span className="truncate">{label}</span>
    </span>
  );
}

export function Group({ title, right, children }: { title?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-5">
      {(title || right != null) && (
        <h2 className="flex items-center gap-2 px-1 mb-2">
          {title && <span className="w-[3px] h-3.5 rounded-sm bg-accent" />}
          {title && <span className="text-[11px] font-bold tracking-[0.12em] text-fg uppercase">{title}</span>}
          {right != null && <span className="ml-auto min-w-0">{right}</span>}
        </h2>
      )}
      <div className="rounded-xl bg-surface border border-line divide-y divide-line overflow-hidden">
        {children}
      </div>
    </section>
  );
}

// Standard section sub-tabs: bold uppercase, full-width, accent-filled when active.
export function SectionTabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: ReactNode; dot?: boolean | string }[] }) {
  const gid = useId();
  return (
    <div className="flex items-stretch gap-2">
      {tabs.map((t) => {
        const active = value === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`le-tap relative flex-1 px-3 py-2 text-[12px] font-bold uppercase tracking-wide rounded-md border transition-colors ${active ? 'text-on-accent border-transparent' : 'bg-field text-fg-2 border-line hover:text-fg'}`}
          >
            {active && <motion.div layoutId={`sectiontab-${gid}`} className="absolute inset-0 rounded-md bg-accent" transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} />}
            <span className="relative z-[1]">
              {t.label}
              {t.dot && <span className={`ml-1.5 inline-block w-1.5 h-1.5 rounded-full align-middle ${typeof t.dot === 'string' ? t.dot : 'bg-red-400'}`} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// Standard character picker: dropdown with an online dot per option.
export function CharacterSelect({ value, onChange, chars, full = true }: { value: string; onChange: (v: string) => void; chars: { name: string; online?: boolean }[]; full?: boolean }) {
  const anon = useAnon();
  return (
    <Select
      value={value}
      onChange={onChange}
      options={chars.map((c) => c.name)}
      full={full}
      renderOption={(nm) => {
        const c = chars.find((x) => x.name === nm);
        return (
          <span className="flex items-center gap-2 min-w-0">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c?.online ? 'bg-emerald-400' : 'bg-fg-4'}`} />
            <span className="truncate">{anon(nm)}</span>
          </span>
        );
      }}
    />
  );
}

export function Row({ label, desc, children }: { label: ReactNode; desc?: string; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5">
      <div className="min-w-0">
        <div className="text-[13px] text-fg-2 leading-tight">{label}</div>
        {desc && <div className="text-[11px] text-fg-4 mt-0.5 leading-snug">{desc}</div>}
      </div>
      {children && <div className="ml-auto shrink-0">{children}</div>}
    </div>
  );
}

export function RowStacked({ label, desc, children }: { label: string; desc?: string; children: ReactNode }) {
  return (
    <div className="px-3.5 py-2.5">
      <div className="text-[13px] text-fg-2 leading-tight">{label}</div>
      {desc && <div className="text-[11px] text-fg-4 mt-0.5 leading-snug">{desc}</div>}
      <div className="mt-2">{children}</div>
    </div>
  );
}

export function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      style={{ filter: on && !disabled ? undefined : 'saturate(0.3)' }}
      className={`relative w-9 h-5 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${on ? 'bg-[var(--color-nav-active)]' : 'bg-[var(--color-track)]'}`}
    >
      <span
        style={{ background: on ? '#fff' : 'var(--color-knob)', transition: 'transform var(--dur-base) var(--ease-spring)' }}
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full shadow ${on ? 'translate-x-4' : ''}`}
      />
    </button>
  );
}

export function Segmented<T extends string>({
  value, options, onChange, full = false,
}: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; full?: boolean }) {
  return (
    <div className={`${full ? 'flex w-full' : 'inline-flex'} rounded-lg bg-field border border-line p-0.5`}>
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={`le-tap ${full ? 'flex-1 ' : ''}px-2.5 py-1.5 text-[11px] font-semibold rounded-md transition-colors ${
            value === o.v ? 'nav-active' : 'text-fg-3 hover:text-fg-2'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({
  value, min = 0, max = 100, step, suffix = '', format, onChange,
}: { value: number; min?: number; max?: number; step?: number; suffix?: string; format?: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-1.5 accent-[var(--color-slider)] cursor-pointer"
      />
      <span className={`text-[11px] tabular-nums text-fg-2 shrink-0 text-right ${format ? 'w-16' : 'w-10'}`}>{format ? format(value) : `${value}${suffix}`}</span>
    </div>
  );
}


// Gil amount field: stores raw digits in `value`, always shows them comma-grouped.
// `onChange` receives the stripped digit string. Pass className to match each call site.
export function GilInput({
  value, onChange, placeholder, className,
}: { value: string; onChange: (digits: string) => void; placeholder?: string; className?: string }) {
  return (
    <input
      inputMode="numeric"
      value={value ? Number(value).toLocaleString() : ''}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
      placeholder={placeholder}
      className={className}
    />
  );
}

// Themed numeric stepper: [ − | value | + ]. Replaces the native <input type="number">
// spinner (un-themeable OS widget). The value stays typeable; buttons clamp to min/max
// and hold-to-repeat. Pass className to control width/height of the outer control.
export function Stepper({
  value, onChange, min, max, step = 1, className, title, numW = 'w-9',
}: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; className?: string; title?: string; numW?: string }) {
  const [text, setText] = useState(String(value));
  const valueRef = useRef(value);
  valueRef.current = value;
  useEffect(() => { setText(String(value)); }, [value]);

  const clamp = (n: number) => {
    if (Number.isNaN(n)) return min ?? 0;
    if (min != null && n < min) return min;
    if (max != null && n > max) return max;
    return n;
  };
  const commit = (n: number) => { const c = clamp(n); setText(String(c)); if (c !== valueRef.current) onChange(c); };
  const bump = (dir: number) => commit(valueRef.current + dir * step);

  const hold = useRef<{ t?: number; i?: number }>({});
  const stopHold = () => {
    if (hold.current.t) window.clearTimeout(hold.current.t);
    if (hold.current.i) window.clearInterval(hold.current.i);
    hold.current = {};
  };
  const startHold = (dir: number) => {
    bump(dir);
    hold.current.t = window.setTimeout(() => { hold.current.i = window.setInterval(() => bump(dir), 70); }, 340);
  };
  useEffect(() => stopHold, []);

  const atMin = min != null && value <= min;
  const atMax = max != null && value >= max;
  const btn = 'shrink-0 w-7 grid place-items-center text-fg-3 enabled:hover:bg-line enabled:hover:text-fg disabled:opacity-30 transition-colors select-none touch-none';

  return (
    <div title={title} className={`inline-flex items-stretch h-8 rounded-md border border-line bg-field overflow-hidden ${className ?? ''}`}>
      <button
        type="button" aria-label="Decrease" disabled={atMin}
        onPointerDown={(e) => { e.preventDefault(); startHold(-1); }} onPointerUp={stopHold} onPointerLeave={stopHold} onPointerCancel={stopHold}
        className={`${btn} border-r border-line`}
      >
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><path d="M5 12h14" /></svg>
      </button>
      <input
        value={text}
        inputMode="numeric"
        onChange={(e) => setText(e.target.value.replace(/[^\d-]/g, ''))}
        onBlur={() => commit(Number(text))}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); else if (e.key === 'ArrowUp') { e.preventDefault(); bump(1); } else if (e.key === 'ArrowDown') { e.preventDefault(); bump(-1); } }}
        className={`${numW} min-w-0 text-center bg-transparent text-[12px] text-fg-2 outline-none tabular-nums`}
      />
      <button
        type="button" aria-label="Increase" disabled={atMax}
        onPointerDown={(e) => { e.preventDefault(); startHold(1); }} onPointerUp={stopHold} onPointerLeave={stopHold} onPointerCancel={stopHold}
        className={`${btn} border-l border-line`}
      >
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
      </button>
    </div>
  );
}

// Themed dropdown replacing native <select>; portals the menu so it escapes scroll clipping and flips up near the screen bottom.
export function Select({
  value, onChange, options, full = false, renderOption, renderValue, menuMaxH = 232, searchable = false,
}: { value: string; onChange: (v: string) => void; options: string[]; full?: boolean; renderOption?: (v: string) => ReactNode; renderValue?: (v: string) => ReactNode; menuMaxH?: number; searchable?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(-1);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  const filtered = searchable && q.trim() ? options.filter((o) => o.toLowerCase().includes(q.trim().toLowerCase())) : options;

  useEffect(() => {
    if (!open) return;
    const r = btn.current?.getBoundingClientRect();
    if (r) {
      const menuH = Math.min(options.length * 30 + 8, menuMaxH);
      const up = r.bottom + menuH > window.innerHeight && r.top > menuH;
      setPos({ left: r.left, top: up ? r.top : r.bottom, width: r.width, up });
    }
    // Close when the PAGE scrolls (the fixed menu can't track the button), but
    // NOT when the menu's own list scrolls — that's how you reach long lists.
    const onScroll = (e: Event) => { if (menu.current?.contains(e.target as Node)) return; setOpen(false); };
    const onResize = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, options.length, menuMaxH]);

  useEffect(() => {
    if (open && searchable) { setQ(''); setHi(-1); const t = setTimeout(() => searchRef.current?.focus(), 10); return () => clearTimeout(t); }
  }, [open, searchable]);
  useEffect(() => { setHi(-1); }, [q]);

  const menuStyle: CSSProperties = pos
    ? (pos.up
      ? { left: pos.left, width: pos.width, bottom: window.innerHeight - pos.top + 4 }
      : { left: pos.left, width: pos.width, top: pos.top + 4 })
    : {};

  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`le-tap ${full ? 'w-full ' : ''}flex items-center justify-between gap-2 bg-surface border border-line rounded-md px-2.5 py-1.5 text-xs text-fg-2 outline-none transition-colors hover:border-accent/50`}
      >
        {renderValue || renderOption ? <span className="flex-1 min-w-0 text-left">{(renderValue ?? renderOption)!(value)}</span> : <span className="truncate">{value}</span>}
        <svg viewBox="0 0 24 24" style={{ transition: 'transform var(--dur-fast) var(--ease-out)' }} className={`w-3.5 h-3.5 shrink-0 text-fg-4 ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {pos && createPortal(
        <>
          {open && <div className="fixed inset-0 z-[60]" onMouseDown={() => setOpen(false)} />}
          <AnimatePresence>
            {open && (
              <motion.div
                ref={menu}
                className={`fixed z-[61] overflow-y-auto rounded-md bg-[var(--color-bg)] border border-line-2 shadow-2xl py-1 ${pos.up ? 'origin-bottom' : 'origin-top'}`}
                style={{ ...menuStyle, maxHeight: menuMaxH }}
                initial={{ opacity: 0, y: pos.up ? 4 : -4, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: pos.up ? 4 : -4, scale: 0.97 }}
                transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
              >
                {searchable && (
                  <div className="sticky top-0 z-[1] bg-[var(--color-bg)] px-1.5 pt-1 pb-1.5 border-b border-line">
                    <input
                      ref={searchRef}
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, filtered.length - 1)); }
                        else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
                        else if (e.key === 'Enter') { e.preventDefault(); const pick = hi >= 0 ? filtered[hi] : filtered[0]; if (pick != null) { onChange(pick); setOpen(false); } }
                      }}
                      placeholder="Search…"
                      className="w-full bg-field border border-line rounded px-2 py-1 text-xs text-fg-2 placeholder-fg-4 outline-none focus:border-accent/50 transition-colors"
                    />
                  </div>
                )}
                {filtered.length === 0 ? (
                  <div className="px-2.5 py-2 text-xs text-fg-4 text-center">No matches</div>
                ) : filtered.map((o, i) => (
                  <button
                    key={o}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); onChange(o); setOpen(false); }}
                    onMouseEnter={searchable ? () => setHi(i) : undefined}
                    className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors ${searchable && i === hi ? 'bg-accent text-on-accent' : o === value ? 'bg-accent/20 text-accent font-semibold' : 'text-fg-2 hover:bg-accent hover:text-on-accent'}`}
                  >
                    {renderOption ? renderOption(o) : o}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </>,
        document.body,
      )}
    </>
  );
}

// Clickable on/off pill (PC / NPC / MOB style multi-select).
export function Chip({ on, onChange, children, full = false }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode; full?: boolean }) {
  return (
    <button
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={`${full ? 'flex-1 ' : ''}px-3 py-1.5 text-[11px] font-bold rounded-md border transition-colors ${
        on ? 'bg-accent text-on-accent border-transparent' : 'bg-field text-fg-3 border-line hover:text-fg-2'
      }`}
    >
      {children}
    </button>
  );
}

// Themed tooltip chip. Render inside a `group relative` trigger; it fades in on
// hover. `compactOnly` shows it only when the app is in the narrow layout
// (where icon labels are hidden).
export function Tip({ label, side = 'right', compactOnly = false }: { label: string; side?: 'right' | 'bottom' | 'top'; compactOnly?: boolean }) {
  const pos =
    side === 'right' ? 'left-full ml-2 top-1/2 -translate-y-1/2'
    : side === 'top' ? 'bottom-full mb-1.5 right-0'
    : 'top-full mt-1.5 right-0';
  const gate = compactOnly ? 'hidden @max-[460px]:block' : '';
  return (
    <span
      role="tooltip"
      className={`pointer-events-none absolute z-50 ${pos} ${gate} whitespace-nowrap rounded-md bg-surface-raised border border-line px-2 py-1 text-[11px] font-semibold text-fg-2 shadow-lg opacity-0 transition-opacity duration-150 group-hover:opacity-100`}
    >
      {label}
    </span>
  );
}

