import { filterExpressionSql } from "./filter-expression-sql";
import type { IssueListQuery } from "./list-schema";

// Every optional record projection is constrained to the issue's workspace.
export const browseJoins = `FROM issues i JOIN teams t ON t.id=i.team_id
 JOIN workflow_statuses s ON s.id=i.status_id AND s.team_id=t.id
 LEFT JOIN operators a ON a.id=i.assignee_operator_id AND a.workspace_id=t.workspace_id AND a.removed_at IS NULL
 LEFT JOIN projects p ON p.id=i.project_id AND p.workspace_id=t.workspace_id
 LEFT JOIN cycles c ON c.id=i.cycle_id AND c.team_id=t.id
 LEFT JOIN project_milestones m ON m.id=i.milestone_id AND m.project_id=p.id
 LEFT JOIN issue_parents link ON link.issue_id=i.id
 LEFT JOIN issues parent ON parent.id=link.parent_issue_id AND EXISTS(SELECT 1 FROM teams pt WHERE pt.id=parent.team_id AND pt.workspace_id=t.workspace_id)`;
export const blockedSql = `EXISTS(SELECT 1 FROM issue_dependencies d
 JOIN issues blocker ON blocker.id=d.blocking_issue_id
 JOIN teams bt ON bt.id=blocker.team_id AND bt.workspace_id=t.workspace_id
 JOIN workflow_statuses bs ON bs.id=blocker.status_id AND bs.team_id=bt.id
 WHERE d.blocked_issue_id=i.id AND bs.category NOT IN ('completed','canceled','duplicate'))`;
const priorityOrder =
  "CASE i.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END";
export const browseSort: Record<IssueListQuery["sort"], string> = {
  newest: "i.created_at DESC",
  oldest: "i.created_at ASC",
  priority: priorityOrder,
  status: "s.position ASC",
  start: "i.start_date IS NULL ASC,i.start_date ASC",
  due: "i.due_date IS NULL ASC,i.due_date ASC",
  updated: "i.updated_at DESC",
  manual: "i.identifier ASC",
};
export const browseGroup: Record<
  IssueListQuery["grouping"],
  { key: string; name: string; order: string; rowOrder: string }
> = {
  none: { key: "'all'", name: "'All issues'", order: "1", rowOrder: "" },
  status: {
    key: "s.id",
    name: "s.name",
    order: "MIN(s.position),name,key",
    rowOrder: "s.position,s.name,s.id",
  },
  assignee: {
    key: "COALESCE(a.id,'none')",
    name: "COALESCE(a.name,'Unassigned')",
    order: "name,key",
    rowOrder: "COALESCE(a.name,'Unassigned'),COALESCE(a.id,'none')",
  },
  priority: {
    key: "i.priority",
    name: "CASE WHEN i.priority='none' THEN 'No priority' ELSE upper(substr(i.priority,1,1))||substr(i.priority,2) END",
    order: `MIN(${priorityOrder}),key`,
    rowOrder: `${priorityOrder},i.priority`,
  },
  project: {
    key: "COALESCE(p.id,'none')",
    name: "COALESCE(p.name,'No project')",
    order: "name,key",
    rowOrder: "COALESCE(p.name,'No project'),COALESCE(p.id,'none')",
  },
  cycle: {
    key: "COALESCE(c.id,'none')",
    name: "COALESCE(c.name,'No cycle')",
    order: "name,key",
    rowOrder: "COALESCE(c.name,'No cycle'),COALESCE(c.id,'none')",
  },
  milestone: {
    key: "COALESCE(m.id,'none')",
    name: "COALESCE(m.name,'No milestone')",
    order: "name,key",
    rowOrder: "COALESCE(m.name,'No milestone'),COALESCE(m.id,'none')",
  },
  parent: {
    key: "COALESCE(parent.id,'none')",
    name: "CASE WHEN parent.id IS NULL THEN 'No parent' ELSE parent.identifier||': '||parent.title END",
    order: "name,key",
    rowOrder: "CASE WHEN parent.id IS NULL THEN 'No parent' ELSE parent.identifier||': '||parent.title END,COALESCE(parent.id,'none')",
  },
  team: {
    key: "t.id",
    name: "t.name",
    order: "name,key",
    rowOrder: "t.name,t.id",
  },
};
const scopeSql = {
  created: "EXISTS(SELECT 1 FROM issue_activity created WHERE created.issue_id=i.id AND created.kind='issue.created' AND created.actor_operator_id=?)",
  subscribed: "EXISTS(SELECT 1 FROM issue_followers f WHERE f.issue_id=i.id AND f.operator_id=?)",
};
export function browseWhere(
  query: IssueListQuery,
  workspace: string,
  today: string,
  actor: string,
) {
  // Archived issues (AUTO-003) leave every list; search with archived records and their own pages still find them.
  const conditions = ["t.workspace_id=?", "i.archived_at IS NULL"],
    values: string[] = [workspace];
  const equal = (column: string, value: string) => {
    conditions.push(`${column}=?`);
    values.push(value);
  };
  const expression = filterExpressionSql(query.expression, blockedSql);
  if (expression.sql) { conditions.push(expression.sql); values.push(...expression.values); }
  if (query.scope !== "all") {
    conditions.push(scopeSql[query.scope]);
    values.push(actor);
  }
  if (query.category !== "all") equal("s.category", query.category);
  // A personal scope lists every such issue; the general list hides completed.
  else if (query.status === "all" && query.scope === "all") conditions.push("s.category<>'completed'");
  if (query.status !== "all") equal("s.id", query.status);
  if (query.priority !== "all") equal("i.priority", query.priority);
  if (query.q) {
    conditions.push(
      "(instr(lower(i.identifier),lower(?))>0 OR instr(lower(i.title),lower(?))>0)",
    );
    values.push(query.q, query.q);
  }
  if (query.assignee === "unassigned") conditions.push("a.id IS NULL");
  else if (query.assignee !== "all") equal("a.id", query.assignee);
  if (query.team !== "all") equal("t.id", query.team);
  for (const [value, column] of [
    [query.project, "i.project_id"],
    [query.cycle, "i.cycle_id"],
  ]) {
    if (value === "none") conditions.push(`${column} IS NULL`);
    else if (value !== "all") equal(column, value);
  }
  if (query.label === "none")
    conditions.push(
      "NOT EXISTS(SELECT 1 FROM issue_labels il JOIN labels l ON l.id=il.label_id AND l.workspace_id=t.workspace_id WHERE il.issue_id=i.id)",
    );
  else if (query.label !== "all") {
    conditions.push(
      "EXISTS(SELECT 1 FROM issue_labels il JOIN labels l ON l.id=il.label_id AND l.workspace_id=t.workspace_id WHERE il.issue_id=i.id AND il.label_id=?)",
    );
    values.push(query.label);
  }
  if (query.start === "none") conditions.push("i.start_date IS NULL");
  if (query.start === "overdue") {
    conditions.push("i.start_date<?");
    values.push(today);
  }
  if (query.start === "range" || query.start === "this_week") {
    conditions.push("i.start_date IS NOT NULL");
    let from = query.startFrom, to = query.startTo;
    if (query.start === "this_week") {
      const day = new Date(today + "T00:00:00Z");
      day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
      from = day.toISOString().slice(0, 10);
      day.setUTCDate(day.getUTCDate() + 6);
      to = day.toISOString().slice(0, 10);
    }
    if (from) { conditions.push("i.start_date>=?"); values.push(from); }
    if (to) { conditions.push("i.start_date<=?"); values.push(to); }
  }
  if (query.due === "none") conditions.push("i.due_date IS NULL");
  if (query.due === "overdue") {
    conditions.push("i.due_date<?");
    values.push(today);
  }
  if (query.due === "range") {
    conditions.push("i.due_date IS NOT NULL");
    if (query.dueFrom) {
      conditions.push("i.due_date>=?");
      values.push(query.dueFrom);
    }
    if (query.dueTo) {
      conditions.push("i.due_date<=?");
      values.push(query.dueTo);
    }
  }
  if (query.blocked !== "all")
    conditions.push(
      `${query.blocked === "unblocked" ? "NOT " : ""}${blockedSql}`,
    );
  if (query.parent === "none") conditions.push("link.issue_id IS NULL");
  else if (query.parent !== "all") equal("parent.identifier", query.parent);
  return {
    relation: `${browseJoins} WHERE ${conditions.join(" AND ")}`,
    values,
  };
}
