import { useMemo } from 'react';
import { useKnownCharacters } from './bridge';
import { Group, Row, Select } from './ui';
import { useSticky } from './sticky';
import { STORABLE_BAGS, ALL_PLAYERS_KEY, ALL_PLAYERS_LABEL } from './storagePrefs';
import { useTagRules, setTagRules, type TagRule } from './tagRules';
import { useItemTags, countForTag, type TagDef } from './itemTags';

// The main Inventory (bag 0) can be a routing target too -- "keep these on the character".
// Added here only for tag routing; STORABLE_BAGS (shared with the Organize Rules'
// storable-bags) stays storage-only so overflow never tries to target Inventory.
const ROUTE_BAGS: { id: number; name: string }[] = [{ id: 0, name: 'Inventory' }, ...STORABLE_BAGS];
const bagName = (id: number) => ROUTE_BAGS.find((x) => x.id === id)?.name ?? String(id);

function ruleSummary(rule: TagRule): string {
  const names = rule.bags.map(bagName);
  if (rule.bags[0] === 0) {
    return rule.bags.length === 1
      ? 'Keep every one in Inventory.'
      : `Keep in Inventory, then store extras in ${names.slice(1).join(', then ')}.`;
  }
  return `Store every one in ${names.join(', then ')}.`;
}

function TagRuleCard({ tag, items, own, inherited, isAll, onChange, onClear, onOverride }: {
  tag: TagDef; items: number; own: TagRule | undefined; inherited: TagRule | undefined; isAll: boolean;
  onChange: (rule: TagRule) => void; onClear: () => void; onOverride: () => void;
}) {
  const following = !isAll && !own && !!inherited;
  const bags = own?.bags ?? [];
  const toggleBag = (bagId: number) => {
    const next = bags.includes(bagId) ? bags.filter((b) => b !== bagId) : [...bags, bagId];
    if (next.length) onChange({ tag: tag.id, bags: next });
    else onClear();
  };

  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-line bg-surface-raised">
        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-bold" style={{ color: tag.color }}>{tag.name}</span>
        <span className="shrink-0 text-[11px] text-fg-4 tabular-nums">{items.toLocaleString()} item{items === 1 ? '' : 's'}</span>
      </div>

      {following ? (
        <div className="px-3 py-2.5 flex items-center gap-2">
          <span className="text-[11px] text-fg-4">Follows All Players:</span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-fg-3">{inherited!.bags.map(bagName).join(' › ')}</span>
          <button onClick={onOverride} className="shrink-0 text-[11px] font-semibold text-accent hover:text-accent-hover transition-colors">Override</button>
        </div>
      ) : (
        <div className="px-3 py-2.5 flex flex-col gap-2.5">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-fg-4 mb-1.5">Store / Keep · Priority Order</div>
            <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(76px, 1fr))' }}>
              {ROUTE_BAGS.map((b) => {
                const idx = bags.indexOf(b.id);
                const on = idx >= 0;
                return (
                  <button key={b.id} onClick={() => toggleBag(b.id)} aria-pressed={on} className={`w-full px-2 py-1.5 text-[11px] font-bold rounded-md border transition-colors truncate ${on ? 'bg-accent text-on-accent border-transparent' : 'bg-field text-fg-3 border-line hover:text-fg-2'}`}>
                    {on ? `${idx + 1}. ${b.name}` : b.name}
                  </button>
                );
              })}
            </div>
          </div>
          {own ? (
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 text-[11px] text-fg-3 rounded-md bg-field/60 px-2.5 py-1.5">{ruleSummary(own)}</span>
              <button onClick={onClear} className="shrink-0 text-[11px] font-semibold text-fg-4 hover:text-red-300 transition-colors">Clear</button>
            </div>
          ) : (
            <div className="text-[11px] text-fg-4">Not routed yet — pick a bag above to send these items there.{!isAll && inherited ? ' (Overriding the All Players rule.)' : ''}</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function TagRulesView() {
  const rules = useTagRules();
  const { tags } = useItemTags();
  const known = useKnownCharacters();
  const charNames = useMemo(() => known.map((k) => k.name).sort((a, b) => a.localeCompare(b)), [known]);
  const [scope, setScope] = useSticky<string>('tagrules.scope', ALL_PLAYERS_LABEL);
  const options = useMemo(() => [ALL_PLAYERS_LABEL, ...charNames], [charNames]);
  const active = options.includes(scope) ? scope : ALL_PLAYERS_LABEL;
  const isAll = active === ALL_PLAYERS_LABEL;
  const scopeKey = isAll ? ALL_PLAYERS_KEY : active;
  const entries = rules[scopeKey] ?? [];
  const allPlayers = rules[ALL_PLAYERS_KEY] ?? [];

  const commit = (next: TagRule[]) => setTagRules(scopeKey, next);
  const upsert = (rule: TagRule) => commit([...entries.filter((e) => e.tag !== rule.tag), rule]);
  const clear = (tagId: string) => commit(entries.filter((e) => e.tag !== tagId));

  return (
    <div className="max-w-2xl mx-auto p-5">
      <Group>
        <Row label="Applies To"><div className="w-44"><Select value={active} onChange={setScope} options={options} full /></div></Row>
      </Group>

      {tags.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface text-center text-[12px] text-fg-4 py-10 px-4">No tags yet. Create some in the <span className="text-fg-2 font-semibold">Tagging</span> tab, then route them here.</div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {tags.map((t) => {
            const own = entries.find((e) => e.tag === t.id);
            const inh = isAll ? undefined : allPlayers.find((e) => e.tag === t.id);
            return (
              <TagRuleCard
                key={t.id} tag={t} items={countForTag(t.id)} own={own} inherited={inh} isAll={isAll}
                onChange={upsert}
                onClear={() => clear(t.id)}
                onOverride={() => { if (inh) upsert({ tag: t.id, bags: inh.bags.slice() }); }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
