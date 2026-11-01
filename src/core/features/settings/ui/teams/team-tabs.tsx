import { Link } from '@tanstack/react-router';

export const teamTabs = ['details', 'workflow', 'people', 'planning', 'automation'] as const;
export type TeamTab = typeof teamTabs[number];
const labels: Record<TeamTab, string> = { details: 'Details', workflow: 'Workflow', people: 'People', planning: 'Planning', automation: 'Automation' };

/** The team's tabs, each at its own path; the current one is an inside tint. At a phone width the strip scrolls inside itself. */
export function TeamTabs({ teamId, current, tabs }: { teamId: string; current: TeamTab; tabs: readonly TeamTab[] }) {
  return <nav className="team-tabs" aria-label="Team sections">
    {tabs.map(tab => <Link key={tab} className="team-tab" to="/app/settings/teams/$teamId/$tab" params={{ teamId, tab }} aria-current={tab === current ? 'page' : undefined}>{labels[tab]}</Link>)}
  </nav>;
}
