import type { Administration } from '../../../administration/schema';
import { TeamTriageRotation } from '../../../triage-responsibility/panel';
import { teamAccess } from '../team-access';
import { TeamJoining } from './team-joining';
import { TeamLeavers } from './team-leavers';
import { TeamMembers } from './team-members';

/** People: members, joining and its requests, the triage rotation, and people who left. */
export function TeamPeople({ data, team }: { data: Administration; team: Administration['teams'][number] }) {
  const access = teamAccess(data, team);
  return <div className="team-people">
    <TeamMembers data={data} team={team} />
    <TeamJoining data={data} team={team} />
    {access.settings && !team.archivedAt && <TeamTriageRotation data={data} team={team} />}
    <TeamLeavers data={data} team={team} />
  </div>;
}
