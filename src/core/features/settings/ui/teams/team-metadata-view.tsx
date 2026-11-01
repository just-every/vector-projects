import type { Administration } from '../../../administration/schema';
import { useAdministrationCall } from '../admin/administration';
import { ChoiceField } from '../fields/choice-field';

type Team = Administration['teams'][number];
const visibilities = [{ value: 'public', label: 'Public' }, { value: 'private', label: 'Private' }] as const;

/** An Admin's view of a private team they are not in: who is in it and how big it is, never its work (administrative metadata only). */
export function TeamMetadataView({ data, team }: { data: Administration; team: Team }) {
  const call = useAdministrationCall();
  const owners = team.members.filter(member => member.role === 'owner').length;
  const issues = team.issueCount ?? 0;
  return <section className="team-metadata" aria-label={`Metadata for ${team.name}`}>
    <p className="field-hint">{team.members.length} {team.members.length === 1 ? 'member' : 'members'} · {owners} {owners === 1 ? 'team owner' : 'team owners'} · {issues} {issues === 1 ? 'issue' : 'issues'}</p>
    <h2 className="group-heading">Members</h2>
    <ul className="settings-rows">
      {team.members.map(member => <li key={member.operatorId} className="metadata-row">
        <span className="row-name">{data.operators.find(person => person.id === member.operatorId)?.name ?? 'Former member'}</span>
        <span className="row-meta">{member.role === 'owner' ? 'Team owner' : 'Member'}</span>
      </li>)}
    </ul>
    <ChoiceField label="Visibility" value={team.isPrivate ? 'private' : 'public'} options={visibilities}
      save={next => call(`/api/settings/teams/${team.id}/privacy`, 'PUT', { isPrivate: next === 'private' })} />
  </section>;
}
