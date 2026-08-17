export type TreasuryLists = { drop: string[]; lot: string[]; pass: string[] };

function decodeEntities(s: string): string {
  return s
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function stripQuotes(s: string): string {
  return s.trim().replace(/^['"]+/, '').replace(/['"]+$/, '').trim();
}

function dedupe(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of arr) {
    const k = n.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(n); }
  }
  return out;
}

function extractTag(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    for (const part of m[1].split(',')) {
      const name = stripQuotes(decodeEntities(part));
      if (name) out.push(name);
    }
  }
  return out;
}

function parseInputList(txt: string): string[] {
  const out: string[] = [];
  for (const line of txt.split(/\r?\n/)) {
    const m = /\/\/(?:tr|treasury)\s+(?:drop|d)\s+(?:add|a|\+)\s+(?:global\s+)?(.+?)\s*$/i.exec(line.replace(/\\\//g, '/'));
    if (m) { const name = stripQuotes(m[1]); if (name) out.push(name); }
  }
  return out;
}

// Some Treasury forks save a Lua table instead of the XML file, e.g.
//   return { Pass = {'Abyss Cape', 'Ace\'s Leggings'}, Lot = {...}, Drop = {...} }
// with single-quoted names and \' escapes. Pull one list (Pass/Lot/Drop) out of it. \bKEY\b avoids
// matching "LotCount"; the list is flat so the first '}' closes it.
function parseLuaList(text: string, key: string): string[] {
  const m = new RegExp(`\\b${key}\\b\\s*=\\s*\\{([\\s\\S]*?)\\}`).exec(text);
  if (!m) return [];
  const out: string[] = [];
  const re = /'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"/g;
  let s: RegExpExecArray | null;
  while ((s = re.exec(m[1])) !== null) {
    const name = (s[1] ?? s[2] ?? '').replace(/\\(['"\\])/g, '$1');
    if (name) out.push(name);
  }
  return out;
}

export function parseTreasury(text: string): TreasuryLists {
  if (/\b(?:Pass|Lot|Drop)\s*=\s*\{/.test(text)) {
    return {
      drop: dedupe(parseLuaList(text, 'Drop')),
      lot: dedupe(parseLuaList(text, 'Lot')),
      pass: dedupe(parseLuaList(text, 'Pass')),
    };
  }
  if (/<settings>/i.test(text) || /<Drop>|<Pass>|<Lot>/i.test(text)) {
    return {
      drop: dedupe(extractTag(text, 'Drop')),
      lot: dedupe(extractTag(text, 'Lot')),
      pass: dedupe(extractTag(text, 'Pass')),
    };
  }
  return { drop: dedupe(parseInputList(text)), lot: [], pass: [] };
}

export function treasurySettingsPath(addonDir: string | null): string | null {
  if (!addonDir) return null;
  const parent = addonDir.replace(/[\\/][^\\/]+$/, '');
  return `${parent}/Treasury/data/settings.xml`;
}
