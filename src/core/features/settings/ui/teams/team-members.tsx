import { useState } from 'react';
import type { Administration } from '../../../administration/schema';
import { useAdministrationCall } from '../admin/administration';
import { ConfirmLine } from '../fields/confirm-line';
import { RowMenu } from '../fields/row-menu';
import { SelectField } from '../fields/select-field';
import { teamAccess } from '../team-access';
import { memberName } from './team-names';

type Team = Administration['teams'][number];
const teamRoles = [{ value: 'owner', label: 'Team owner' }, { value: 'member', label: 'Member' }] as const;

function MemberRow({ data, team, member, editable }: { data: Administration; team: Team; member: Team['members'][number]; editable: boolean }) {
  const call = useAdministrationCall();
  const [removing, setRemoving] = useState(false);
  const person = memberName(data, member.operatorId);
  const door = `/api/settings/teams/${team.id}/members/${member.operatorId}`;
  return <li className="member-row row-hover">
    <div className="member-line">
      <span className="row-name">{person}</span>
      {editable
        ? <>
          <SelectField className="inline-field" label={`Team role for ${person}`} value={member.role} options={teamRoles} save={next => call(door, 'PUT', { role: next })} />
          <RowMenu name={person} items={[{ label: 'Remove from team', onSelect: () => setRemoving(true) }]} />
        </>
        : <span className="row-meta">{member.role === 'owner' ? 'Team owner' : 'Member'}</span>}
    </div>
    {removing && <ConfirmLine question={`Remove ${person} from ${team.name}?`} detail="They keep their assigned issues, which are listed here for reassignment." confirm="Remove from team"
      onConfirm={() => call(door, 'DELETE')} onCancel={() => setRemoving(false)} />}
  </li>;
}

/** ROLE-007: a team's members and team owners, managed by its team owners or an Admin. */
export function TeamMembers({ data, team }: { data: Administration; team: Team }) {
  const call = useAdministrationCall();
  const access = teamAccess(data, team);
  const editable = access.members && !team.archivedAt;
  const outside = data.operators.filter(person => (['owner', 'admin'].includes(data.viewer.role) || !['guest', 'viewer'].includes(person.role)) && !team.members.some(member => member.operatorId === person.id));
  return <section className="team-block" aria-label={`${team.name} members`}>
    <h2 className="group-heading">Members</h2>
    {team.members.length > 0 && <ul className="member-rows">{team.members.map(member => <MemberRow key={member.operatorId} data={data} team={team} member={member} editable={editable} />)}</ul>}
    {!team.members.some(member => member.role === 'owner') && <p className="field-hint">This team has no team owner. Admins manage it until one is named.</p>}
    {editable && outside.length > 0 && <SelectField label="Add member" value="" hint={undefined}
      options={[{ value: '', label: 'Choose a member' }, ...outside.map(person => ({ value: person.id, label: person.name }))]}
      save={async next => { if (next) await call(`/api/settings/teams/${team.id}/members/${next}`, 'PUT', { role: 'member' }); }} />}
    {!access.members && <p className="field-hint">Only this team’s owners and Admins change its members.</p>}
  </section>;
}
