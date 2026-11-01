import type { Administration } from '../../../administration/schema';
import { useAdministrationCall } from '../admin/administration';
import { SwitchField } from '../fields/switch-field';

/** Enable cycles for this team: stored as it flips. Off, the cycle controls are hidden and automation pauses; nothing is discarded. */
export function TeamCyclesSwitch({ team, editable }: { team: Administration['teams'][number]; editable: boolean }) {
  const call = useAdministrationCall();
  return <section className="team-block" aria-label="Cycles">
    {editable
      ? <SwitchField label="Enable cycles" value={team.cyclesEnabled} save={next => call(`/api/settings/teams/${team.id}`, 'PATCH', { cyclesEnabled: next })}
        hint="Turning cycles off hides cycle controls and pauses automation. Commitments, schedules and closed snapshots stay available when you turn cycles on again." />
      : <dl className="plain-values"><div><dt>Cycles</dt><dd>{team.cyclesEnabled ? 'On' : 'Off'}</dd></div></dl>}
  </section>;
}
