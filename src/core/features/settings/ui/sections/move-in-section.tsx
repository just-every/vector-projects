import { DataPanel } from '../../../data/ui/data-panel';
import { SectionGate } from '../shell/section-gate';
import { SectionPage } from '../shell/section-page';

export function MoveInSection() {
  return <SectionGate section="move-in" title="Move in">
    <SectionPage title="Move in" legacy><DataPanel /></SectionPage>
  </SectionGate>;
}
