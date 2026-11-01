import { NotFoundLine, SectionPage } from '../shell/section-page';
import { teamAccess } from '../team-access';
import { TeamAutomation } from './team-automation';
import { TeamDetails } from './team-details';
import { TeamMetadataView } from './team-metadata-view';
import { TeamPeople } from './team-people';
import { TeamPlanning } from './team-planning';
import { TeamTabs, teamTabs, type TeamTab } from './team-tabs';
import { TeamWorkflow } from './team-workflow';
import { useAdministration } from '../admin/administration';

const back = { label: 'Teams', to: '/app/settings/teams' } as const;

/**
 * One team in the pane, under "Teams › name": a meta line and five tabs, each at its own path. Automation is for whoever
 * may change the team's settings (Owners, Admins, and a Member the team's permission admits) and is absent for everyone
 * else, never greyed; an unknown team or tab gets one plain line.
 */
export function TeamRecord({ teamId, tab }: { teamId: string; tab?: string }) {
  const { data } = useAdministration();
  const team = data.teams.find(item => item.id === teamId);
  const access = team && teamAccess(data, team);
  if (!team || !access?.opens) return <SectionPage title="Teams"><NotFoundLine what="That team" back={back} /></SectionPage>;
  const tabs = teamTabs.filter(item => access.settings || item !== 'automation');
  const current = (tab ?? 'details') as TeamTab;
  if (!(tabs as readonly string[]).includes(current)) return <SectionPage title="Teams"><NotFoundLine what="That tab" back={back} /></SectionPage>;
  if (!team.canRead) return <SectionPage title={team.name} parent={back} record={team.name}><TeamMetadataView data={data} team={team} /></SectionPage>;
  const sub = <><span className="key">{team.identifierPrefix}</span> · {team.archivedAt ? 'Archived' : team.isPrivate ? 'Private' : 'Public'}
    {team.issueCount === null ? '' : ` · ${team.issueCount} ${team.issueCount === 1 ? 'issue' : 'issues'}`}</>;
  return <SectionPage title={team.name} parent={back} record={team.name} sub={sub}>
    <TeamTabs teamId={team.id} current={current} tabs={tabs} />
    <div className="team-tab-body">
      {current === 'details' && <TeamDetails data={data} team={team} />}
      {current === 'workflow' && <TeamWorkflow data={data} team={team} />}
      {current === 'people' && <TeamPeople data={data} team={team} />}
      {current === 'planning' && <TeamPlanning data={data} team={team} />}
      {current === 'automation' && <TeamAutomation data={data} team={team} />}
    </div>
  </SectionPage>;
}
