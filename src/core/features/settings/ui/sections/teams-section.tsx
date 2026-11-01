import { HousekeepingPanel } from '../../../housekeeping/panel';
import { SectionGate } from '../shell/section-gate';
import { NotFoundLine, SectionPage } from '../shell/section-page';
import { teamAccess } from '../team-access';
import { TeamsPanel } from '../teams-panel';
import { WithAdministration } from './with-administration';

export const teamTabs = ['details', 'workflow', 'people', 'planning', 'automation'] as const;

/** Teams. A record or tab path opens that team's editor in the list under its breadcrumb until the team record replaces it. */
export function TeamsSection({ teamId, tab }: { teamId?: string; tab?: string }) {
  return <SectionGate section="teams" title="Teams">
    <WithAdministration>{(data, reload) => {
      const parent = { label: 'Teams', to: '/app/settings/teams' } as const;
      const team = teamId ? data.teams.find(item => item.id === teamId && teamAccess(data, item).opens) : undefined;
      if ((teamId && !team) || (tab && !(teamTabs as readonly string[]).includes(tab)))
        return <SectionPage title="Teams"><NotFoundLine what={team ? 'That tab' : 'That team'} back={parent} /></SectionPage>;
      const leads = data.viewer.role === 'owner' || data.viewer.role === 'admin';
      return <SectionPage title="Teams" legacy parent={team ? parent : undefined} record={team?.name}>
        <TeamsPanel data={data} onChanged={reload} openTeamId={team?.id} />
        {leads && <HousekeepingPanel data={data} onChanged={reload} />}
      </SectionPage>;
    }}</WithAdministration>
  </SectionGate>;
}
