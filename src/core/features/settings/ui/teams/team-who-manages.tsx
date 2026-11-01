import type { Administration } from '../../../administration/schema';
import { useAdministrationCall } from '../admin/administration';
import { SelectField } from '../fields/select-field';
import { useSerialSaves } from '../fields/serial-saves';
import { teamAccess } from '../team-access';

type Team = Administration['teams'][number];
type Permission = Team['settingsPermission'];
type Permissions = { settings: Permission; planning: Permission };
const choices = [{ value: 'team_owners', label: 'Team owners only' }, { value: 'all_members', label: 'All team members' }] as const;
const label = (value: Permission) => choices.find(choice => choice.value === value)!.label;

/** ROLE-009: who manages the team's settings, and who its cycles and templates. */
export function TeamWhoManages({ data, team }: { data: Administration; team: Team }) {
  const call = useAdministrationCall();
  const serial = useSerialSaves<Permissions>({ settings: team.settingsPermission, planning: team.planningPermission });
  const store = (change: Partial<Permissions>) => serial(async base => {
    const result = await call(`/api/settings/teams/${team.id}/permissions`, 'PUT', { ...base, ...change });
    const stored = result.teams.find(item => item.id === team.id)!;
    return { settings: stored.settingsPermission, planning: stored.planningPermission };
  });
  return <section className="team-block" aria-label="Who manages">
    <h2 className="group-heading">Who manages</h2>
    {teamAccess(data, team).permissions && !team.archivedAt
      ? <div className="manage-grid">
        <SelectField label="Team settings" value={team.settingsPermission} options={choices} save={next => store({ settings: next })} />
        <SelectField label="Cycles and templates" value={team.planningPermission} options={choices} save={next => store({ planning: next })} />
      </div>
      : <dl className="plain-values">
        <div><dt>Team settings</dt><dd>{label(team.settingsPermission)}</dd></div>
        <div><dt>Cycles and templates</dt><dd>{label(team.planningPermission)}</dd></div>
      </dl>}
  </section>;
}
