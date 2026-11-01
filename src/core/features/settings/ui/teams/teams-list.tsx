import { Link } from '@tanstack/react-router';
import type { Administration } from '../../../administration/schema';
import { rememberListScroll } from '../shell/list-scroll';
import { teamAccess } from '../team-access';
import { useRowAction } from './team-row-action';

type Team = Administration['teams'][number];

function TeamRow({ data, team }: { data: Administration; team: Team }) {
  const access = teamAccess(data, team);
  const { action, note, error, pending } = useRowAction(data, team);
  const meta = [
    team.issueCount === null ? null : `${team.issueCount} ${team.issueCount === 1 ? 'issue' : 'issues'}`,
    team.isPrivate ? 'Private' : null,
    team.archivedAt ? 'Archived' : null,
    access.standing === 'owner' ? 'You own this team' : access.standing ? 'You are a member' : null,
    note || null,
  ].filter(Boolean);
  return <li className="team-row row-hover">
    <div className="row-main">
      {access.opens
        ? <Link className="row-name team-link" to="/app/settings/teams/$teamId" params={{ teamId: team.id }} onClick={() => rememberListScroll('teams')}>{team.name}</Link>
        : <span className="row-name">{team.name}</span>}
      <span className="row-meta"><span className="key">{team.identifierPrefix}</span>{meta.map(part => <span key={part as string}> · {part}</span>)}</span>
    </div>
    {action && <button type="button" className="button-text row-action" disabled={pending} onClick={action.run}>{action.label}</button>}
    <span className="row-chevron" aria-hidden="true">{access.opens ? '›' : ''}</span>
    {error && <p className="confirm-error team-row-error" role="alert">{error}</p>}
  </li>;
}

/** The teams this person is shown: Owners and Admins every team; a Member their own, and the open or requestable teams they may join. */
function shownTeams(data: Administration) {
  const leads = data.viewer.role === 'owner' || data.viewer.role === 'admin';
  return data.teams.filter(team => {
    const access = teamAccess(data, team);
    if (leads || access.opens) return true;
    return access.join && !team.archivedAt && (team.membershipMode === 'open' && !team.isPrivate || team.requestsEnabled && access.request);
  });
}

/** Name, key · issues · standing; Join, Request to join and Leave appear on hover and focus. */
export function TeamsList({ data }: { data: Administration }) {
  const shown = shownTeams(data);
  if (!shown.length) return <p className="empty-line">{data.viewer.role === 'owner' || data.viewer.role === 'admin' ? 'No teams yet' : 'You are not in a team yet.'}</p>;
  return <ul className="settings-rows" aria-label="Teams">{shown.map(team => <TeamRow key={team.id} data={data} team={team} />)}</ul>;
}
