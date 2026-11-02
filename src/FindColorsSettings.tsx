import { useEffect, useRef, useState } from 'react';
import { Group, Row } from './ui';
import { Popover } from './overlay';
import { useFindColors, setFindColors, FIND_PALETTE, FIND_PALETTE_BY_CODE, FIND_BAGS } from './findColors';

const CHECKER = 'linear-gradient(45deg,#555 25%,transparent 25%,transparent 75%,#555 75%),linear-gradient(45deg,#555 25%,transparent 25%,transparent 75%,#555 75%)';

function ColorPicker({ value, onChange }: { value: number; onChange: (code: number) => void }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const entry = FIND_PALETTE_BY_CODE.get(value);
  const hex = value ? entry?.hex : undefined;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  return (
    <>
      <button ref={btnRef} onClick={() => setOpen((o) => !o)} className="le-tap flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-line bg-field hover:border-line-2 transition-colors w-[132px]">
        <span className="w-4 h-4 rounded shrink-0 border border-black/25" style={hex ? { background: hex } : { backgroundImage: CHECKER, backgroundSize: '6px 6px', backgroundPosition: '0 0, 3px 3px' }} />
        <span className="text-[12px] text-fg-2 flex-1 text-left truncate">{value ? (entry?.name ?? `Code ${value}`) : 'Default'}</span>
      </button>
      <Popover open={open} anchor={btnRef} className="rounded-lg border border-line bg-popover shadow-2xl">
        <div ref={menuRef} className="p-2">
          <div className="grid grid-cols-4 gap-1">
            <button
              onClick={() => { onChange(0); setOpen(false); }}
              title="Default"
              className={`w-6 h-6 rounded border grid place-items-center text-[11px] text-fg-4 ${value === 0 ? 'border-accent ring-1 ring-accent' : 'border-line'}`}
              style={{ backgroundImage: CHECKER, backgroundSize: '6px 6px', backgroundPosition: '0 0, 3px 3px' }}
            />
            {FIND_PALETTE.map((c) => (
              <button
                key={c.code}
                onClick={() => { onChange(c.code); setOpen(false); }}
                title={`${c.name} (${c.code})`}
                className={`w-6 h-6 rounded border ${value === c.code ? 'border-accent ring-1 ring-accent' : 'border-black/25'}`}
                style={{ background: c.hex }}
              />
            ))}
          </div>
        </div>
      </Popover>
    </>
  );
}

export function FindColorsSettings() {
  const fc = useFindColors();
  return (
    <Group title="Findall Colors">
      <div className="text-[11px] text-fg-4 px-0.5 pb-1 leading-snug">Colors for the in-game //find and //findall output. Swatches are approximate. Run //ax colortest in-game to preview the exact colors.</div>
      <Row label="Character Name"><ColorPicker value={fc.name} onChange={(name) => setFindColors({ ...fc, name })} /></Row>
      <Row label="Item Name"><ColorPicker value={fc.item} onChange={(item) => setFindColors({ ...fc, item })} /></Row>
      {FIND_BAGS.map((b) => (
        <Row key={b.key} label={b.label}>
          <ColorPicker value={fc.bags[b.key] ?? 0} onChange={(code) => setFindColors({ ...fc, bags: { ...fc.bags, [b.key]: code } })} />
        </Row>
      ))}
    </Group>
  );
}
