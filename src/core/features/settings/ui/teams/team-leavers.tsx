import type { Administration } from '../../../administration/schema';
import { memberName } from './team-names';

/** Issues still assigned to people who have left; shown only while there are some. */
export function TeamLeavers({ data, team }: { data: Administration; team: Administration['teams'][number] }) {
  if (!team.departedAssignments.length) return null;
  return <section className="team-block" aria-label="Assigned to people who left">
    <h2 className="group-heading">Assigned to people who left</h2>
    <ul className="settings-rows">
      {team.departedAssignments.map(issue => <li key={issue.identifier} className="metadata-row">
        <span className="row-name"><span className="key">{issue.identifier}</span> {issue.title}</span>
        <span className="row-meta">{memberName(data, issue.assigneeOperatorId)}</span>
      </li>)}
    </ul>
  </section>;
}
