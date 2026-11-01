import type { Administration } from '../../../administration/schema';

export type Status = Administration['teams'][number]['statuses'][number];
export const categoryNames: Record<Status['category'], string> = {
  intake: 'Intake', backlog: 'Backlog', unstarted: 'To do', started: 'In progress', completed: 'Done', canceled: 'Canceled', duplicate: 'Duplicate',
};
export const categories = Object.keys(categoryNames) as Status['category'][];

/** The five groups the workflow is shown in. Each status keeps its own category; the group only gathers them. */
export const groups: { key: string; label: string; categories: Status['category'][] }[] = [
  { key: 'not-started', label: 'Not started', categories: ['intake', 'backlog', 'unstarted'] },
  { key: 'started', label: 'In progress', categories: ['started'] },
  { key: 'completed', label: 'Done', categories: ['completed'] },
  { key: 'canceled', label: 'Canceled', categories: ['canceled'] },
  { key: 'duplicate', label: 'Duplicate', categories: ['duplicate'] },
];

export const byPosition = (statuses: Status[]) => [...statuses].sort((a, b) => a.position - b.position);

/** The whole team's order after moving `moved` to sit where `before` is, or to the group's end when `before` is null. */
export function movedOrder(statuses: Status[], moved: string, before: string | null, group: Status['category'][]) {
  const ids = byPosition(statuses).map(status => status.id);
  const inGroup = (id: string) => group.includes(statuses.find(status => status.id === id)!.category);
  if (!inGroup(moved) || (before !== null && !inGroup(before)) || moved === before) return ids;
  const rest = ids.filter(id => id !== moved);
  const at = before === null
    ? 1 + Math.max(...rest.map((id, index) => (inGroup(id) ? index : -1)))
    : rest.indexOf(before);
  rest.splice(at, 0, moved);
  return rest;
}

/** The order after `moved` is dropped on `target` (or nudged onto its neighbour): it takes the target's place in the group. */
export function droppedOrder(statuses: Status[], moved: string, target: string, group: Status['category'][]) {
  const members = byPosition(statuses).filter(status => group.includes(status.category)).map(status => status.id);
  const from = members.indexOf(moved), to = members.indexOf(target);
  if (from < 0 || to < 0 || from === to) return null;
  return movedOrder(statuses, moved, from < to ? members[to + 1] ?? null : target, group);
}
