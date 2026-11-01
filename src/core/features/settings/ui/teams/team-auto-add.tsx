import type { Administration } from '../../../administration/schema';
import { useAdministrationCall } from '../admin/administration';
import { SwitchField } from '../fields/switch-field';

type Team = Administration['teams'][number];
const rules = [
  ['autoCycleStarted', 'Add uncommitted work to the active cycle when it starts'],
  ['autoCycleCompleted', 'Add uncommitted work to the active cycle when it completes'],
] as const;

/** The two auto-add rules. Each stores as it flips; for someone who may not change them they are plain text. */
export function TeamAutoAdd({ team, editable }: { team: Team; editable: boolean }) {
  const call = useAdministrationCall();
  return <section className="team-block" aria-label="Add work automatically">
    <h2 className="group-heading">Add work automatically</h2>
    {editable
      ? rules.map(([key, label]) => <SwitchField key={key} label={label} value={team[key]} save={next => call(`/api/settings/teams/${team.id}`, 'PATCH', { [key]: next })} />)
      : <dl className="plain-values">{rules.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{team[key] ? 'On' : 'Off'}</dd></div>)}</dl>}
  </section>;
}
