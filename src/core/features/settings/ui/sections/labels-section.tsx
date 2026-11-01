import { SectionGate } from '../shell/section-gate';
import { SectionPage } from '../shell/section-page';
import { LabelsPanel } from '../labels-panel';
import { WithAdministration } from './with-administration';

export function LabelsSection() {
  return <SectionGate section="labels" title="Labels">
    <WithAdministration>{(data, reload) =>
      <SectionPage title="Labels" legacy>
        <LabelsPanel labels={data.labels} onChanged={reload} readOnly={data.viewer.role !== 'owner' && data.viewer.role !== 'admin'} />
      </SectionPage>}
    </WithAdministration>
  </SectionGate>;
}
