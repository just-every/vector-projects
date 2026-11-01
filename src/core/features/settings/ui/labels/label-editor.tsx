import type { Administration } from '../../../administration/schema';
import { useAdministrationCall } from '../admin/administration';
import { ColorField } from '../fields/color-field';
import { SwitchField } from '../fields/switch-field';
import { TextField } from '../fields/text-field';

type Label = Administration['labels'][number];

/** An opened label: rename (on blur), colour (the native input) and Use for projects, each stored as it changes. */
export function LabelEditor({ label }: { label: Label }) {
  const call = useAdministrationCall();
  const patch = (change: object) => call(`/api/settings/labels/${label.id}`, 'PATCH', change);
  return <div className="label-editor">
    <TextField label="Name" value={label.name} save={next => patch({ name: next.trim() })} />
    <ColorField label="Colour" value={label.color} save={next => patch({ color: next })} />
    <SwitchField label="Use for projects" value={label.projectsEnabled} save={next => patch({ projectsEnabled: next })} />
  </div>;
}
