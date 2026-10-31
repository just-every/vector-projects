import { manualBrowseOrder } from '../manual-order/browse';
import { parseTasks } from "../description-history/tasks";
import { PaginationInvalidated, resultRevision } from "./list-revision";
import type { IssueListQuery, IssueListData } from "./list-schema";
import { browseActor, workspaceDate } from "./browse-access";
import { blockedSql, browseGroup, browseSort, browseWhere } from "./browse-sql";

type Row = {
  id: string;
  identifier: string;
  title: string;
  description: string;
  version: number;
  cycleId: string | null;
  priority: IssueListData["issues"][number]["priority"];
  createdAt: string;
  updatedAt: string;
  startDate: string | null;
  dueDate: string | null;
  statusId: string;
  statusName: string;
  category: string;
  teamId: string;
  teamName: string;
  assigneeId: string | null;
  assigneeName: string | null;
  projectId: string | null;
  projectName: string | null;
  milestoneId: string | null;
  milestoneName: string | null;
  cycleName: string | null;
  parentIdentifier: string | null;
  parentTitle: string | null;
  labels: string;
  blocked: number;
  groupKey: string;
};
/** REST renders only groups on this page while retaining global SQL counts. */
export function issueListResponse(data: IssueListData): IssueListData {
  const present = new Set(data.issues.map((issue) => issue.groupKey));
  return {
    ...data,
    allGroups: data.groups,
    groups: data.groups.filter((group) => present.has(group.key)),
  };
}
/** Counts scan SQL predicates; only one bounded page of issue rows leaves D1. */
export async function listIssues(
  db: D1Database,
  actor: string,
  query: IssueListQuery,
  now = new Date(),
): Promise<IssueListData> {
  const access = await browseActor(db, actor);
  const today = workspaceDate(now, access.timezone);
  const { relation, values } = browseWhere(query, access.workspace_id, today, actor);
  const group = browseGroup[query.grouping];
  const manual = await manualBrowseOrder(db, actor, access.workspace_id, query);
  const order = [group.rowOrder, manual?.sql ?? browseSort[query.sort], "i.identifier ASC"]
    .filter(Boolean)
    .join(",");
  const [identity, count, rows, assignees, groups, statusCounts] =
    await db.batch([
      db.prepare(
        "SELECT CAST(revision AS TEXT) revision FROM issue_list_revision WHERE id=1",
      ),
      db.prepare(`SELECT COUNT(*) total ${relation}`).bind(...values),
      db
        .prepare(
          `SELECT i.id,i.identifier,i.title,i.description,i.version,i.priority,c.id cycleId,i.created_at createdAt,i.updated_at updatedAt,i.start_date startDate,i.due_date dueDate,
 s.id statusId,s.name statusName,s.category,t.id teamId,t.name teamName,a.id assigneeId,a.name assigneeName,p.id projectId,p.name projectName,c.name cycleName,
 m.id milestoneId,m.name milestoneName,
 parent.identifier parentIdentifier,parent.title parentTitle,${blockedSql} blocked,${group.key} groupKey,
 (SELECT json_group_array(json_object('id',id,'name',name,'color',color)) FROM (SELECT l.id,l.name,l.color FROM issue_labels il JOIN labels l ON l.id=il.label_id AND l.workspace_id=t.workspace_id WHERE il.issue_id=i.id ORDER BY l.name,l.id)) labels
 ${relation} ORDER BY ${order} LIMIT ${query.pageSize} OFFSET ?`,
        )
        .bind(...values, ...(manual?.values ?? []), query.offset),
      db
        .prepare(
          "SELECT id,name FROM operators WHERE workspace_id=? AND removed_at IS NULL ORDER BY name,id",
        )
        .bind(access.workspace_id),
      db
        .prepare(
          `SELECT ${group.key} key,${group.name} name,COUNT(*) count ${relation} GROUP BY ${group.key},${group.name} ORDER BY ${group.order}`,
        )
        .bind(...values),
      ...(query.pageSize === 100
        ? [
            db
              .prepare(
                `SELECT s.id key,COUNT(*) count ${relation} GROUP BY s.id ORDER BY MIN(s.position),s.id`,
              )
              .bind(...values),
          ]
        : []),
    ]);
  await browseActor(db, actor, access.workspace_id);
  const revision = await resultRevision(
    query,
    `${access.workspace_id}:${actor}:${access.teamScope}`,
    today,
    (identity.results[0] as { revision: string }).revision,
    groups.results as IssueListData["groups"],
  );
  if (query.offset > 0 && query.revision !== revision)
    throw new PaginationInvalidated();
  return {
    revision,
    total: Number((count.results[0] as { total: number }).total),
    offset: query.offset,
    pageSize: query.pageSize,
    assignees: assignees.results as IssueListData["assignees"],
    groups: groups.results as IssueListData["groups"],
    ...(statusCounts
      ? {
          statusCounts: statusCounts.results as NonNullable<
            IssueListData["statusCounts"]
          >,
        }
      : {}),
    issues: (rows.results as Row[]).map((row) => ({
      id: row.id,
      identifier: row.identifier,
      title: row.title,
      checklist: checklistProgress(row.description),
      version: row.version,
      priority: row.priority,
      cycleId: row.cycleId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      startDate: row.startDate,
      dueDate: row.dueDate,
      milestoneId: row.milestoneId,
      milestone: row.milestoneId ? { id: row.milestoneId, name: row.milestoneName!, projectId: row.projectId! } : null,
      status: {
        id: row.statusId,
        name: row.statusName,
        category: row.category,
      },
      team: { id: row.teamId, name: row.teamName },
      assignee: row.assigneeId
        ? { id: row.assigneeId, name: row.assigneeName! }
        : null,
      project: row.projectId
        ? { id: row.projectId, name: row.projectName! }
        : null,
      cycle: row.cycleId ? { id: row.cycleId, name: row.cycleName! } : null,
      parent: row.parentIdentifier
        ? { identifier: row.parentIdentifier, title: row.parentTitle! }
        : null,
      labels: JSON.parse(row.labels),
      blocked: row.blocked === 1,
      groupKey: row.groupKey,
    })),
  };
}

function checklistProgress(source: string) { const tasks = parseTasks(source); return { completed: tasks.filter(task => task.checked).length, total: tasks.length }; }
