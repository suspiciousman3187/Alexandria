import { SectionTabs } from './ui';
import { useSticky } from './sticky';
import TagBuilderView from './TagBuilderView';
import TagRulesView from './TagRulesView';

// The Tagging area: two tabbed views sharing one nav entry, mirroring Organize.
// "Tagging" is the item tagger; "Rules" is the full tag-routing editor.
export default function TaggingView() {
  const [tab, setTab] = useSticky<'tagging' | 'rules'>('tagging.tab', 'tagging');
  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-4 pt-4 pb-3 border-b border-line">
        <SectionTabs value={tab} onChange={setTab} tabs={[{ id: 'tagging', label: 'Tagging' }, { id: 'rules', label: 'Rules' }]} />
      </div>
      <div className="flex-1 min-h-0">
        {tab === 'tagging' ? <TagBuilderView /> : <div className="h-full overflow-y-auto"><TagRulesView /></div>}
      </div>
    </div>
  );
}
