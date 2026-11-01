import { useState } from 'react';
import { decide } from '../../../roles/policy';
import { AdministrationScope, useAdministration } from '../admin/administration';
import { SectionGate } from '../shell/section-gate';
import { useRestoreListScroll } from '../shell/list-scroll';
import { SectionPage } from '../shell/section-page';
import { NewTeamForm } from '../teams/new-team-form';
import { TeamRecord } from '../teams/team-record';
import { TeamsList } from '../teams/teams-list';
import '../teams/teams.css';

/** Teams: the list with New team in place; a record or tab path opens that team under "Teams › name". */
export function TeamsSection({ teamId, tab }: { teamId?: string; tab?: string }) {
  return <SectionGate section="teams" title="Teams">
    <AdministrationScope title="Teams" parent={teamId ? { label: 'Teams', to: '/app/settings/teams' } : undefined}>{teamId ? <TeamRecord teamId={teamId} tab={tab} /> : <Directory />}</AdministrationScope>
  </SectionGate>;
}

function Directory() {
  const { data } = useAdministration();
  const [creating, setCreating] = useState(false);
  const leads = data.viewer.role === 'owner' || data.viewer.role === 'admin';
  const creates = decide({ role: data.viewer.role, memberInvites: false, memberTeamCreation: data.workspace.memberTeamCreation, teams: new Map() }, { row: 'teams.create' }) === 'allow';
  useRestoreListScroll('teams');
  const opener = creates && !creating ? <button type="button" className="button-quiet" onClick={() => setCreating(true)}>New team</button> : undefined;
  return <SectionPage title="Teams" action={opener}>
    {creating && <NewTeamForm mayPrivate={leads} onClose={() => setCreating(false)} />}
    <TeamsList data={data} />
  </SectionPage>;
}
