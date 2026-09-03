// Rolling diagnostic log written to disk, built to survive a hard freeze / GPU driver crash: a small ring
// buffer is flushed to `alexandria_debug.log` routinely (every 5s) AND immediately whenever something
// suspicious happens (a long main-thread task, an error, the page being frozen). Because a GPU TDR /
// system hang can take everything down, the value is in what's already on disk when it happens -- the tail
// shows the memory/frame-rate/jank trend and the last breadcrumbs (e.g. scrolling the Curio catalog) right
// before the crash. Captures the hardware/renderer info we otherwise have to ask the user for by hand.
import { invoke } from '@tauri-apps/api/core';
import { appLocalDataDir } from '@tauri-apps/api/path';
import { inTauri } from './bridge';

type Entry = { t: number; ev: string; d?: unknown };

const RING = 600;
const buf: Entry[] = [];
let started = false;
let dirty = false;
let logPath: string | null = null;
let curView = '';
let flushInFlight = false;
let bootLine: string | null = null; // hardware + GPU/renderer + VRAM; pinned out of the ring so it never rolls off
// A crash (white tabs / GPU TDR) freezes the log tail on disk, but a RESTART starts a fresh ring that
// overwrites it -- and users restart the moment it happens, so the crash log was being lost. On boot we copy
// the prior session's log to alexandria_debug.prev.log BEFORE writing anything new, so the crash tail survives
// a restart and can still be sent. `preserved` gates the first flush until that copy is done (no race).
let preserved: Promise<void> | null = null;

const ms = () => Math.round(performance.now());

async function preservePrevLog() {
  if (!inTauri) return;
  try {
    const base = (await appLocalDataDir()).replace(/[\\/]+$/, '');
    const prev = await invoke<string>('read_text_file', { path: `${base}/alexandria_debug.log` });
    if (prev && prev.trim()) await invoke('write_text_file', { path: `${base}/alexandria_debug.prev.log`, contents: prev });
  } catch { /* no prior log, or unreadable -- fine */ }
}

export function dlog(ev: string, d?: unknown, urgent = false) {
  const e: Entry = { t: ms(), ev, d };
  // The boot line (hardware, GPU/renderer, VRAM) is the field we most need for a GPU crash, but it was the
  // OLDEST entry and rolled out of the 600-ring on any session longer than ~20 min. Keep it OUT of the ring and
  // pin it as the first line of every flush so it always survives.
  if (ev === 'boot') { bootLine = line(e); dirty = true; void flush(); return; }
  buf.push(e);
  if (buf.length > RING) buf.splice(0, buf.length - RING);
  dirty = true;
  if (urgent) void flush();
}

// Note the active screen so the heartbeat and any crash tail say where the user was.
export function setDebugView(view: string) {
  if (view !== curView) { curView = view; dlog('view', view); }
}

function line(e: Entry): string {
  let s = `${e.t}\t${e.ev}`;
  if (e.d !== undefined) { try { s += '\t' + JSON.stringify(e.d); } catch { s += '\t' + String(e.d); } }
  return s;
}

async function flush() {
  if (!inTauri || !dirty || flushInFlight) return;
  flushInFlight = true;
  dirty = false;
  try {
    if (preserved) await preserved; // let the prior session's log roll to .prev before we overwrite it
    if (!logPath) { const base = (await appLocalDataDir()).replace(/[\\/]+$/, ''); logPath = `${base}/alexandria_debug.log`; }
    const body = (bootLine ? bootLine + '\n' : '') + buf.map(line).join('\n') + '\n';
    await invoke('write_text_file', { path: logPath, contents: body });
  } catch { dirty = true; /* retry next tick */ }
  flushInFlight = false;
}

function gpuInfo(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl') || c.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) { out.webgl = 'unavailable'; return out; }
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) {
      out.renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
      out.vendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL);
    }
    out.glVersion = gl.getParameter(gl.VERSION);
    out.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  } catch (e) { out.gpuErr = String(e); }
  return out;
}

function mem(): Record<string, number> | undefined {
  const m = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  if (!m) return undefined;
  const mb = (b: number) => Math.round(b / 1048576);
  return { usedMB: mb(m.usedJSHeapSize), totalMB: mb(m.totalJSHeapSize), limitMB: mb(m.jsHeapSizeLimit) };
}

export function startDebugLog() {
  if (started || !inTauri) return;
  started = true;
  preserved = preservePrevLog(); // back up last session's log (the crash tail) before this one overwrites it

  dlog('boot', {
    ua: navigator.userAgent,
    dpr: window.devicePixelRatio,
    screen: `${window.screen.width}x${window.screen.height}`,
    cores: navigator.hardwareConcurrency,
    deviceMemoryGB: (navigator as unknown as { deviceMemory?: number }).deviceMemory,
    gpu: gpuInfo(),
  }, true);

  // Long main-thread tasks -- a cluster of these is what precedes a compositor stall / freeze.
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.duration >= 120) dlog('longtask', { ms: Math.round(e.duration) }, e.duration >= 400);
    });
    po.observe({ entryTypes: ['longtask'] });
  } catch { /* longtask not supported */ }

  // Frame pacing: count frames and track the worst frame gap each heartbeat window. rAF pauses when the
  // window is hidden/minimized, so fps:0 is itself a signal.
  let frames = 0; let worst = 0; let lastRaf = performance.now();
  const raf = () => { const t = performance.now(); const dt = t - lastRaf; lastRaf = t; frames++; if (dt > worst) worst = dt; requestAnimationFrame(raf); };
  requestAnimationFrame(raf);

  window.setInterval(() => {
    const domNodes = document.getElementsByTagName('*').length;
    // Urgent-flush on a jank spike OR a heavy DOM (a big icon view mounting) -- both precede the GPU-overload
    // crashes -- so the lead-up is on disk even if the very next paint is the one that TDRs the display.
    dlog('hb', { view: curView, mem: mem(), fps: frames, worstFrameMs: Math.round(worst), domNodes }, worst >= 300 || domNodes >= 4000);
    frames = 0; worst = 0;
  }, 2000);

  // Event-driven flushing keeps idle disk writes near zero: the urgent flushes above (a long task, a
  // frame-time spike, page-freeze, the window being hidden, an error) fire exactly when a crash is
  // imminent, so the lead-up is on disk. This slow safety flush is only a backstop for a freeze that
  // somehow gave no warning at all -- in normal smooth use it costs one small write every 30s.
  window.setInterval(() => { void flush(); }, 30000);

  document.addEventListener('freeze', () => dlog('page-freeze', undefined, true));
  document.addEventListener('resume', () => dlog('page-resume', undefined, true));
  document.addEventListener('visibilitychange', () => dlog('visibility', document.visibilityState, document.visibilityState === 'hidden'));
  window.addEventListener('error', (e) => dlog('window-error', { msg: String(e.message), src: e.filename, line: e.lineno }, true));
  window.addEventListener('unhandledrejection', (e) => dlog('unhandled-rejection', String((e as PromiseRejectionEvent).reason), true));
  window.addEventListener('pagehide', () => { void flush(); });
}

export async function debugLogPath(): Promise<string> {
  if (!logPath && inTauri) { try { const base = (await appLocalDataDir()).replace(/[\\/]+$/, ''); logPath = `${base}/alexandria_debug.log`; } catch { /* */ } }
  return logPath ?? '';
}
