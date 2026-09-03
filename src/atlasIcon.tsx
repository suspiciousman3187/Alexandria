import { useEffect, useState, useSyncExternalStore } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { inTauri } from './bridge';

const COLS = 32;
const PER = COLS * COLS;
const SHEET_PX = 1024;         // each atlas sheet PNG is 1024x1024
const CELL = SHEET_PX / COLS;  // native cell size within a sheet (32px)

let atlasMap: Map<number, number> | null = null;
let sheetCount = 0;
let loaded = false;
const listeners = new Set<() => void>();

async function loadAtlas() {
  if (loaded) return;
  loaded = true;
  try {
    const r = await fetch('/atlas/cat_index.json');
    if (r.ok) {
      const ids = await r.json();
      if (Array.isArray(ids)) {
        atlasMap = new Map(ids.map((id: number, i: number) => [id, i]));
        sheetCount = Math.ceil(ids.length / PER);
        for (let k = 0; k < sheetCount; k++) {
          const img = new Image();
          img.src = `/atlas/cat_${k}.png`;
        }
      }
    }
  } catch { /* */ }
  listeners.forEach((l) => l());
}
void loadAtlas();

function useAtlasMap(): Map<number, number> | null {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => atlasMap, () => atlasMap);
}

function Mono({ name, size }: { name: string; size: number }) {
  return <span className="text-fg-4 font-bold" style={{ fontSize: Math.max(8, Math.round(size * 0.36)) }}>{(name[0] || '?').toUpperCase()}</span>;
}

function BmpImg({ id, name, assets, size }: { id: number; name: string; assets: string; size: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [id]);
  if (failed) return <Mono name={name} size={size} />;
  return <img src={convertFileSrc(`${assets}/icon_${id}.bmp`)} alt="" onError={() => setFailed(true)} className="w-full h-full object-contain" />;
}

export function IconInner({ id, size, name, assets, bmpHas }: { id: number; size: number; name: string; assets?: string; bmpHas: boolean }) {
  const map = useAtlasMap();
  const idx = id > 0 ? map?.get(id) : undefined;
  if (idx != null) {
    const sheet = Math.floor(idx / PER);
    const within = idx % PER;
    const col = within % COLS;
    const row = Math.floor(within / COLS);
    // Draw the cell at its NATIVE resolution and GPU-scale the div to `size` with a transform, rather than
    // forcing a non-native `background-size`. A scaled background-size makes the browser rasterize and cache
    // a resized copy of the whole 1024x1024 sheet for every (sheet, size) pair; across 23 sheets and several
    // icon sizes that is a large, redundant GPU-memory cost -- the most likely trigger for the icon-dense
    // Curio view crashing the display on lower-VRAM machines running several game clients. A CSS transform
    // reuses the already-decoded native texture and allocates no extra raster.
    return (
      <div style={{ width: size, height: size, overflow: 'hidden' }}>
        <div
          style={{
            width: CELL,
            height: CELL,
            backgroundImage: `url(/atlas/cat_${sheet}.png)`,
            backgroundPosition: `-${col * CELL}px -${row * CELL}px`,
            transform: size === CELL ? undefined : `scale(${size / CELL})`,
            transformOrigin: 'top left',
          }}
        />
      </div>
    );
  }
  if (bmpHas && assets && inTauri) return <BmpImg id={id} name={name} assets={assets} size={size} />;
  return <Mono name={name} size={size} />;
}
