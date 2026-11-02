import { useEffect, useState, type ReactNode } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { Modal } from './overlay';
import { inTauri } from './bridge';

const KEY = 'alex_whatsnew';

// After an auto-update installs and relaunches, the previous version stashed the
// release notes under KEY. On the new version's first launch we show them once,
// so the GitHub release notes ARE the in-app notes (one source, nothing to double-maintain).
export default function WhatsNew() {
  const [data, setData] = useState<{ version: string; body: string } | null>(null);
  useEffect(() => {
    if (!inTauri) return;
    let raw: string | null = null;
    try { raw = localStorage.getItem(KEY); } catch { return; }
    if (!raw) return;
    let parsed: { version?: string; body?: string };
    try { parsed = JSON.parse(raw); } catch { try { localStorage.removeItem(KEY); } catch { /* ignore */ } return; }
    void (async () => {
      let cur = '';
      try { cur = await getVersion(); } catch { /* ignore */ }
      try { localStorage.removeItem(KEY); } catch { /* ignore */ }
      if (parsed.version && parsed.body && (!cur || parsed.version === cur)) {
        setData({ version: parsed.version, body: parsed.body });
      }
    })();
  }, []);
  if (!data) return null;
  return (
    <Modal onClose={() => setData(null)} panelClass="w-[min(94vw,540px)]">
      {(close) => (
        <div className="flex flex-col max-h-[86vh]">
          {/* Header: version pill + "Release Notes" on a soft accent wash. */}
          <div className="px-4 py-3.5 border-b border-line bg-accent/10">
            <span className="inline-block rounded-full bg-accent text-on-accent px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide tabular-nums">Alexandria v{data.version}</span>
            <div className="text-[13px] font-semibold text-fg mt-1.5">Release Notes</div>
          </div>
          <div className="px-4 py-3 overflow-y-auto"><Notes text={data.body} /></div>
          <div className="px-4 py-3 border-t border-line flex justify-end">
            <button onClick={close} className="le-tap px-4 py-2 text-[12px] font-bold rounded-md bg-accent text-on-accent hover:bg-accent-hover transition-colors">Got It</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// Inline markdown: **bold**, `code`, [link](url), *em* / _em_.
function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))|(\*([^*]+)\*)|(_([^_]+)_)/g;
  let last = 0; let key = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1]) nodes.push(<strong key={key++} className="font-semibold text-fg">{m[2]}</strong>);
    else if (m[3]) nodes.push(<code key={key++} className="rounded bg-field px-1 py-0.5 text-[0.92em] font-mono">{m[4]}</code>);
    else if (m[5]) nodes.push(<a key={key++} href={m[7]} target="_blank" rel="noreferrer" className="text-accent hover:underline">{m[6]}</a>);
    else if (m[8]) nodes.push(<em key={key++}>{m[9]}</em>);
    else if (m[10]) nodes.push(<em key={key++}>{m[11]}</em>);
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

// A section's tone is inferred from its heading text so the notes group visually: fixes read as success
// (emerald), everything else as accent. Purely a read of the author's own headings -- no content invented.
type Tone = 'accent' | 'success';
function toneOf(text: string): Tone { return /\b(fix|bug|patch)/i.test(text) ? 'success' : 'accent'; }

const Sparkles = () => (
  <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" /></svg>
);
const BugIcon = () => (
  <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="8" y="6" width="8" height="12" rx="4" /><path d="M9 6a3 3 0 0 1 6 0M3 11h3M18 11h3M3 17h3M18 17h3M12 18v3M4 8l3 2M20 8l-3 2" /></svg>
);

// Full release-notes markdown: tone-grouped sections (New / Fixes), sub-headings, bullets, paragraphs, code.
function Notes({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let i = 0; let key = 0;
  let tone: Tone = 'accent';

  while (i < lines.length) {
    const line = lines[i];

    if (line.trimStart().startsWith('```')) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) { buf.push(lines[i]); i++; }
      i++;
      out.push(<pre key={key++} className="overflow-x-auto rounded bg-field p-2.5 text-[11px] leading-relaxed font-mono"><code>{buf.join('\n')}</code></pre>);
      continue;
    }

    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const lvl = h[1].length;
      const htext = h[2].trim();
      // Skip a redundant title line -- the header already shows the version + "Release Notes".
      if (lvl === 1 && /^alexandria\b|\breleased\b/i.test(htext)) { i++; continue; }

      if (lvl === 1) {
        tone = toneOf(htext);
        const success = tone === 'success';
        let n = 0;
        for (let j = i + 1; j < lines.length; j++) {
          if (/^#\s+/.test(lines[j])) break;
          if (/^\s*([-*+]|\d+\.)\s+/.test(lines[j])) n++;
        }
        out.push(
          <div key={key++} className="mt-4 flex items-center gap-2 first:mt-0">
            <span className={`grid place-items-center h-[26px] w-[26px] flex-none rounded-md border ${success ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300' : 'border-accent/40 bg-accent/15 text-accent'}`}>
              {success ? <BugIcon /> : <Sparkles />}
            </span>
            <span className={`text-[11px] font-semibold uppercase tracking-wide ${success ? 'text-emerald-300' : 'text-accent'}`}>{inline(htext)}</span>
            {n > 0 && <span className="ml-auto text-[10px] text-fg-4 tabular-nums">{n}</span>}
          </div>,
        );
      } else {
        out.push(
          <div key={key++} className={`mt-2.5 pl-[34px] text-[10px] font-semibold uppercase tracking-wide ${tone === 'success' ? 'text-emerald-300/80' : 'text-accent/80'}`}>
            {inline(htext)}
          </div>,
        );
      }
      i++;
      continue;
    }

    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const success = tone === 'success';
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        const content = lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, '');
        items.push(
          <li key={items.length} className="flex gap-2.5">
            <span aria-hidden="true" className={`mt-[7px] h-1.5 w-1.5 flex-none rounded-full ${success ? 'bg-emerald-300' : 'bg-accent'}`} />
            <span className="min-w-0 text-[12px] text-fg-2 leading-relaxed">{inline(content)}</span>
          </li>,
        );
        i++;
      }
      out.push(<ul key={key++} className="mt-1.5 flex list-none flex-col gap-1.5 pl-[34px]">{items}</ul>);
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      out.push(<hr key={key++} className="my-2 border-line" />);
      i++;
      continue;
    }

    if (line.trim() === '') { i++; continue; }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,3})\s|^\s*([-*+]|\d+\.)\s|^```/.test(lines[i])) {
      para.push(lines[i]); i++;
    }
    out.push(<p key={key++} className="pl-[34px] text-[12px] text-fg-3 leading-relaxed my-0.5">{inline(para.join(' '))}</p>);
  }
  return <div className="flex flex-col">{out}</div>;
}
