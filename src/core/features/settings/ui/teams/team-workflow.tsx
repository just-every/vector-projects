import { useState } from 'react';
import type { Administration } from '../../../administration/schema';
import { useAdministrationCall } from '../admin/administration';
import { FailureLine, SavedMark } from '../fields/field-feedback';
import { useAutosave } from '../fields/use-autosave';
import { teamAccess } from '../team-access';
import { AddStatus } from './add-status';
import { StatusRow } from './status-row';
import { byPosition, droppedOrder, groups } from './workflow-groups';

type Team = Administration['teams'][number];
const sameOrder = (a: string[], b: string[]) => a.length === b.length && a.every((id, index) => id === b[index]);

/** Statuses in their five groups, each with a handle and a "…"; a drag or the handle's arrow keys store the new order at once. */
export function TeamWorkflow({ data, team }: { data: Administration; team: Team }) {
  const call = useAdministrationCall();
  const editable = teamAccess(data, team).workflow && !team.archivedAt;
  const [dragging, setDragging] = useState<string | null>(null);
  const order = useAutosave<string[]>({
    value: byPosition(team.statuses).map(status => status.id), same: sameOrder, label: 'Workflow order',
    save: ids => call(`/api/settings/teams/${team.id}/statuses/order`, 'PUT', { statusIds: ids }),
  });
  // The order shown is the one just chosen until the server's answer has taken over.
  const shown = order.shown;
  const statuses = [...team.statuses].sort((a, b) => shown.indexOf(a.id) - shown.indexOf(b.id));
  const place = (moved: string, target: string) => {
    const group = groups.find(item => item.categories.includes(statuses.find(status => status.id === moved)!.category))!;
    const next = droppedOrder(statuses, moved, target, group.categories);
    if (next) void order.commit(next);
  };
  const drag = {
    id: dragging, set: setDragging,
    drop: (target: string) => { if (dragging) place(dragging, target); setDragging(null); },
    step: (id: string, step: -1 | 1) => {
      const group = groups.find(item => item.categories.includes(statuses.find(status => status.id === id)!.category))!;
      const members = statuses.filter(status => group.categories.includes(status.category));
      const neighbour = members[members.findIndex(status => status.id === id) + step];
      if (neighbour) place(id, neighbour.id);
    },
  };
  return <div className="team-workflow">
    <div className="workflow-order"><SavedMark state={order.state} /></div>
    {groups.map(group => {
      const members = statuses.filter(status => group.categories.includes(status.category));
      if (!members.length) return null;
      return <section key={group.key} className="workflow-group" aria-label={group.label}>
        <h2 className="group-heading">{group.label}</h2>
        <ul className="status-rows">
          {members.map(status => {
            const sameCategory = statuses.filter(other => other.category === status.category);
            return <StatusRow key={status.id} team={team} status={status} sameCategory={sameCategory}
              isDefault={sameCategory.length > 1 && sameCategory[0]!.id === status.id} editable={editable} drag={drag} />;
          })}
        </ul>
      </section>;
    })}
    <FailureLine failed={order.failed} reason={order.reason} onRetry={order.retry} />
    {editable ? <AddStatus team={team} /> : !team.archivedAt && <p className="field-hint">Only this team’s owners and Admins change its workflow.</p>}
  </div>;
}
