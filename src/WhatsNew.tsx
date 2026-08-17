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
    <Modal onClose={() => setData(null)} panelClass="w-[min(94vw,460px)]">
      {(close) => (
        <div className="flex flex-col max-h-[86vh]">
          <div className="px-4 py-3.5 border-b border-line">
            <div className="text-[14px] font-bold text-fg">What's New</div>
            <div className="text-[11px] font-semibold text-accent">Alexandria v{data.version}</div>
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

// Minimal markdown for our release-notes shape: '# ' / '## ' headings, '* '/'- ' bullets, plain lines.
function Notes({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const out: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = (key: string) => {
    if (!bullets.length) return;
    out.push(<ul key={key} className="list-disc pl-5 my-1.5 flex flex-col gap-1">{bullets.map((b, i) => <li key={i} className="text-[12px] text-fg-2 leading-relaxed">{b}</li>)}</ul>);
    bullets = [];
  };
  lines.forEach((ln, i) => {
    const t = ln.trim();
    if (t.startsWith('## ')) { flush(`f${i}`); out.push(<div key={i} className="text-[10px] font-bold uppercase tracking-wide text-fg-4 mt-3 mb-0.5">{t.slice(3)}</div>); }
    else if (t.startsWith('# ')) { flush(`f${i}`); out.push(<div key={i} className="text-[13px] font-extrabold text-fg mt-3 first:mt-0 mb-1">{t.slice(2)}</div>); }
    else if (t.startsWith('* ') || t.startsWith('- ')) { bullets.push(t.slice(2)); }
    else if (t) { flush(`f${i}`); out.push(<div key={i} className="text-[12px] text-fg-3 leading-relaxed my-0.5">{t}</div>); }
    else { flush(`f${i}`); }
  });
  flush('end');
  return <>{out}</>;
}
