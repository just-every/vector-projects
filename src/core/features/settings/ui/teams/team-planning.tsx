import type { Administration } from '../../../administration/schema';
import { teamAccess } from '../team-access';
import { TeamAutoAdd } from './team-auto-add';
import { TeamSchedule } from './team-schedule';
import { TeamWhoManages } from './team-who-manages';

/**
 * Planning: the automatic schedule, the two auto-add rules and who manages them. The schedule follows who may plan
 * (`cycles.schedule`); the auto-add rules are saved through the team-settings door, so they are controls for whoever
 * that door admits.
 */
export function TeamPlanning({ data, team }: { data: Administration; team: Administration['teams'][number] }) {
  const access = teamAccess(data, team);
  const open = !team.archivedAt;
  return <div className="team-planning">
    <TeamSchedule data={data} team={team} editable={access.planning && open} />
    <TeamAutoAdd team={team} editable={access.settings && open} />
    <TeamWhoManages data={data} team={team} />
  </div>;
}
