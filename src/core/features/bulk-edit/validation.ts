import seed from "../../../../seed.json";
import type { BulkIssueInput } from "./input";
export type BulkFailure = { identifier: string; reasons: string[] };
/** This exact query serves preflight and transaction admission. A stale issue
 * does not mask another issue's invalid options, or its own other failures. */
export function bulkValidation(
  db: D1Database,
  actor: string,
  input: BulkIssueInput,
) {
  const selection = JSON.stringify(input.issues),
    changes = JSON.stringify(input.changes);
  const sql = `WITH requested AS (SELECT json_extract(value,'$.identifier') identifier,json_extract(value,'$.expectedVersion') version FROM json_each(?)),
    change AS (SELECT ? body), checks AS (
    SELECT r.identifier,
      i.id IS NULL AS unavailable,
      i.id IS NOT NULL AND i.version<>r.version AS stale,
      json_type(c.body,'$.statusId') IS NOT NULL AND json_extract(c.body,'$.statusId')<>i.status_id AND
        (s.category IN ('intake','duplicate') OR NOT EXISTS(SELECT 1 FROM workflow_statuses n WHERE n.id=json_extract(c.body,'$.statusId') AND n.team_id=i.team_id AND n.category IN ('backlog','unstarted','started','completed','canceled'))) AS status,
      json_extract(c.body,'$.assigneeOperatorId') IS NOT NULL AND json_extract(c.body,'$.assigneeOperatorId') IS NOT i.assignee_operator_id AND
        NOT EXISTS(SELECT 1 FROM operators o WHERE o.id=json_extract(c.body,'$.assigneeOperatorId') AND o.workspace_id=t.workspace_id AND o.removed_at IS NULL) AS assignee,
      json_extract(c.body,'$.projectId') IS NOT NULL AND json_extract(c.body,'$.projectId') IS NOT i.project_id AND
        NOT EXISTS(SELECT 1 FROM projects p WHERE p.id=json_extract(c.body,'$.projectId') AND p.workspace_id=t.workspace_id AND p.archived_at IS NULL) AS project,
      json_extract(c.body,'$.milestoneId') IS NOT NULL AND
        NOT EXISTS(SELECT 1 FROM project_milestones m JOIN projects p ON p.id=m.project_id
          WHERE m.id=json_extract(c.body,'$.milestoneId') AND p.workspace_id=t.workspace_id
            AND m.project_id=CASE WHEN json_type(c.body,'$.projectId') IS NULL THEN i.project_id ELSE json_extract(c.body,'$.projectId') END) AS milestone,
      json_type(c.body,'$.cycleId') IS NOT NULL AND json_extract(c.body,'$.cycleId') IS NOT i.cycle_id AND
        (t.cycles_enabled=0 OR (json_extract(c.body,'$.cycleId') IS NOT NULL AND
          (NOT EXISTS(SELECT 1 FROM cycles cy WHERE cy.id=json_extract(c.body,'$.cycleId') AND cy.team_id=i.team_id AND cy.closed_at IS NULL) OR
           NOT EXISTS(SELECT 1 FROM workflow_statuses n WHERE n.id=COALESCE(json_extract(c.body,'$.statusId'),i.status_id) AND n.team_id=i.team_id AND n.category NOT IN ('completed','canceled','duplicate'))))) AS cycle,
      (CASE WHEN json_type(c.body,'$.startDate') IS NULL THEN i.start_date ELSE json_extract(c.body,'$.startDate') END) >
        (CASE WHEN json_type(c.body,'$.dueDate') IS NULL THEN i.due_date ELSE json_extract(c.body,'$.dueDate') END) AS dateOrder,
      json_type(c.body,'$.labelIds') IS NOT NULL AND (json_array_length(c.body,'$.labelIds')>${seed.limits.labelsPerIssue} OR json_array_length(c.body,'$.labelIds')<>(SELECT count(DISTINCT value) FROM json_each(c.body,'$.labelIds'))) AS labelLimit,
      json_type(c.body,'$.labelIds') IS NOT NULL AND EXISTS(SELECT 1 FROM json_each(c.body,'$.labelIds') selected
        WHERE NOT EXISTS(SELECT 1 FROM labels l WHERE l.id=selected.value AND (l.workspace_id=t.workspace_id OR EXISTS(SELECT 1 FROM issue_labels il WHERE il.issue_id=i.id AND il.label_id=l.id)))) AS labels
    FROM requested r CROSS JOIN change c LEFT JOIN issues i ON i.identifier=r.identifier AND EXISTS(
      SELECT 1 FROM teams scope JOIN operators actor ON actor.workspace_id=scope.workspace_id WHERE scope.id=i.team_id AND actor.id=? AND actor.removed_at IS NULL)
    LEFT JOIN teams t ON t.id=i.team_id LEFT JOIN workflow_statuses s ON s.id=i.status_id)
    SELECT * FROM checks`;
  const values = [selection, changes, actor];
  return {
    statement: db.prepare(sql).bind(...values),
    admission: db
      .prepare(
        `SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM (${sql}) WHERE unavailable OR stale OR status OR assignee OR project OR milestone OR cycle OR labels OR labelLimit OR dateOrder) THEN 1 ELSE json('bulk edit admission denied') END`,
      )
      .bind(...values),
  };
}
const reasons = {
  dateOrder: "Start date must be on or before due date.",
  unavailable: "Issue is unavailable.",
  stale: "The issue version is stale.",
  status: "The workflow status transition is unavailable for this issue.",
  assignee: "Assignee is unavailable in this workspace.",
  project: "Project is unavailable or archived.",
  milestone: "Milestone is unavailable for this project in this workspace.",
  cycle: "Cycle is unavailable for this team or terminal work.",
  labels: "Every added label must exist in this workspace.",
  labelLimit: `Choose at most ${seed.limits.labelsPerIssue} distinct labels.`,
};
export async function bulkFailures(
  db: D1Database,
  actor: string,
  input: BulkIssueInput,
): Promise<BulkFailure[]> {
  const rows = await bulkValidation(db, actor, input).statement.all<
    { identifier: string } & Record<keyof typeof reasons, number>
  >();
  return rows.results.flatMap((row) => {
    const failures = Object.entries(reasons)
      .filter(([key]) => row[key as keyof typeof reasons])
      .map(([, message]) => message);
    return failures.length
      ? [{ identifier: row.identifier, reasons: failures }]
      : [];
  });
}
