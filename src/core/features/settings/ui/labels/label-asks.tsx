import { useId, useState } from 'react';
import type { Administration } from '../../../administration/schema';
import { useAdministrationCall } from '../admin/administration';
import { ConfirmLine } from '../fields/confirm-line';

type Label = Administration['labels'][number];

/** Merge into…: pick the destination, then the one ask. */
export function MergeAsk({ label, others, onCancel }: { label: Label; others: Label[]; onCancel: () => void }) {
  const id = useId();
  const call = useAdministrationCall();
  const [destination, setDestination] = useState(others[0]?.id ?? '');
  return <ConfirmLine question={`Merge ${label.name} into`} confirm="Merge label" onCancel={onCancel}
    detail="Merging relabels issues, projects and saved-view filters and removes this label."
    onConfirm={() => call(`/api/settings/labels/${label.id}/merge`, 'POST', { destinationLabelId: destination })}>
    <div className="field">
      <label className="visually-hidden" htmlFor={id}>Merge {label.name} into</label>
      <select id={id} value={destination} onChange={event => setDestination(event.target.value)}>
        {others.map(other => <option key={other.id} value={other.id}>{other.name}</option>)}
      </select>
    </div>
  </ConfirmLine>;
}

export function DeleteAsk({ label, onCancel }: { label: Label; onCancel: () => void }) {
  const call = useAdministrationCall();
  return <ConfirmLine question={`Delete ${label.name}?`} detail="It will be removed from projects, issues and saved-view filters."
    confirm="Delete label" danger onCancel={onCancel} onConfirm={() => call(`/api/settings/labels/${label.id}`, 'DELETE')} />;
}
