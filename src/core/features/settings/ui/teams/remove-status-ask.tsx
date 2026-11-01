import { useId, useState } from 'react';
import type { Administration } from '../../../administration/schema';
import { useAdministrationCall } from '../admin/administration';
import { ConfirmLine } from '../fields/confirm-line';
import type { Status } from './workflow-groups';

/** Remove a status: its issues move to another status in the same category, chosen first. */
export function RemoveStatusAsk({ team, status, choices, onCancel }: {
  team: Administration['teams'][number]; status: Status; choices: Status[]; onCancel: () => void;
}) {
  const id = useId();
  const call = useAdministrationCall();
  const [destination, setDestination] = useState(choices[0]?.id ?? '');
  return <ConfirmLine question={`Remove ${status.name}? Move its issues to`} confirm="Remove status" onCancel={onCancel}
    onConfirm={() => call(`/api/settings/teams/${team.id}/statuses/${status.id}`, 'DELETE', { destinationStatusId: destination })}>
    <div className="field">
      <label className="visually-hidden" htmlFor={id}>Destination status</label>
      <select id={id} value={destination} onChange={event => setDestination(event.target.value)}>
        {choices.map(choice => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
      </select>
      <p className="field-hint">Choose a same-category destination</p>
    </div>
  </ConfirmLine>;
}
