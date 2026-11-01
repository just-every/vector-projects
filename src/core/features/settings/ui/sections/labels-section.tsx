import { useState } from 'react';
import { AdministrationScope, useAdministration } from '../admin/administration';
import { ManagedLabel, ReadOnlyLabel } from '../labels/label-row';
import { NewLabelForm } from '../labels/new-label-form';
import { SectionGate } from '../shell/section-gate';
import { useRestoreListScroll } from '../shell/list-scroll';
import { SectionPage } from '../shell/section-page';
import '../labels/labels.css';

/** Labels: the workspace's labels, edited in place by Owners and Admins; read-only (dot, name, usage) for everyone else. */
export function LabelsSection() {
  return <SectionGate section="labels" title="Labels">
    <AdministrationScope title="Labels"><Labels /></AdministrationScope>
  </SectionGate>;
}

function Labels() {
  const { data } = useAdministration();
  const [creating, setCreating] = useState(false);
  const manages = data.viewer.role === 'owner' || data.viewer.role === 'admin';
  // A Member creates labels exactly when the workspace lets Members; a Viewer never does.
  const creates = manages || (data.viewer.role === 'member' && data.workspace.memberLabelCreation);
  useRestoreListScroll('labels');
  const opener = creates && !creating
    ? <button type="button" className="button-quiet" onClick={() => setCreating(true)}>New label</button> : undefined;
  return <SectionPage title="Labels" action={data.labels.length ? opener : undefined}>
    {creating && <NewLabelForm onClose={() => setCreating(false)} />}
    {data.labels.length === 0
      ? !creating && <p className="empty-line">No labels yet {opener}</p>
      : <ul className="settings-rows" aria-label="Labels">
        {data.labels.map(label => manages
          ? <ManagedLabel key={label.id} label={label} labels={data.labels} />
          : <ReadOnlyLabel key={label.id} label={label} />)}
      </ul>}
  </SectionPage>;
}
