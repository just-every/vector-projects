import { Navigate } from '@tanstack/react-router';
import { WithAdministration } from './with-administration';

/** The old Auto-close link: a lone team's Automation tab, otherwise the Teams list (several teams, as in the demo). */
export function HousekeepingRedirect() {
  return <WithAdministration>{data => {
    const active = data.teams.filter(team => !team.archivedAt);
    return active.length === 1
      ? <Navigate to="/app/settings/teams/$teamId/$tab" params={{ teamId: active[0]!.id, tab: 'automation' }} replace />
      : <Navigate to="/app/settings/teams" replace />;
  }}</WithAdministration>;
}
