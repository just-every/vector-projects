import type { Administration } from '../../../administration/schema';
import { useAdministrationCall } from '../admin/administration';
import { ChoiceField } from '../fields/choice-field';
import { Refusal } from '../fields/use-autosave';
import { TextField } from '../fields/text-field';
import { teamAccess } from '../team-access';
import { TeamArchive } from './team-archive';

type Team = Administration['teams'][number];
const Static = ({ label, value }: { label: string; value: string }) => <p className="record-line"><span>{label}</span><strong>{value}</strong></p>;
const visibilities = [{ value: 'public', label: 'Public' }, { value: 'private', label: 'Private' }] as const;

/** Details: name (stored on blur or Enter), the prefix, visibility, documents and Archive. Read-only values are plain text. */
export function TeamDetails({ data, team }: { data: Administration; team: Team }) {
  const call = useAdministrationCall();
  const access = teamAccess(data, team);
  const leads = data.viewer.role === 'owner' || data.viewer.role === 'admin';
  const edits = access.settings && !team.archivedAt;
  const patch = (change: object) => call(`/api/settings/teams/${team.id}`, 'PATCH', change);
  return <div className="team-details">
    {!access.settings && <p className="field-hint">Only this team’s owners and Admins change its settings.</p>}
    {edits ? <TextField label="Name" value={team.name} save={next => patch({ name: next.trim() })} /> : <Static label="Name" value={team.name} />}
    {edits && team.prefixEditable
      ? <TextField label="Identifier prefix" value={team.identifierPrefix} hint="Two to ten uppercase letters"
        save={async next => { if (!/^[A-Z]{2,10}$/.test(next.trim())) throw new Refusal('Use two to ten uppercase letters.'); await patch({ identifierPrefix: next.trim() }); }} />
      : <div className="field"><Static label="Identifier prefix" value={team.identifierPrefix} />
        {!team.prefixEditable && <p className="field-hint">Locked because this team has issued identifiers.</p>}</div>}
    {leads && !team.archivedAt
      ? <ChoiceField label="Visibility" value={team.isPrivate ? 'private' : 'public'} options={visibilities}
        save={next => call(`/api/settings/teams/${team.id}/privacy`, 'PUT', { isPrivate: next === 'private' })} />
      : <Static label="Visibility" value={team.isPrivate ? 'Private' : 'Public'} />}
    {team.canRead && <div className="field"><h2 className="group-heading">Team documents</h2><a className="document-team-link link-button" href={`/app/teams/${team.id}`}>Open team documents</a></div>}
    {access.archive
      ? <><hr className="record-rule" /><TeamArchive team={team} /></>
      : access.settings && <p className="field-hint">Only this team’s owners and Admins archive or unarchive it.</p>}
  </div>;
}
