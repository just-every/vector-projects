import type { CopySource } from "./snapshot";
import type { DroppedCopyValue } from "./schema";
import { IssueMutationError } from "../issues/errors";

/** Native moves and copies share workspace team/status eligibility. Labels and
 * custom fields currently have workspace scope, so their destination mapping
 * is identity; team statuses and cycles cannot carry their old team IDs. */
export async function copyDestination(
  db: D1Database,
  teamId: string,
  workspaceId: string,
) {
  const row = await db
    .prepare(
      `SELECT t.id,t.identifier_prefix,s.id status_id FROM teams t
    JOIN workflow_statuses s ON s.team_id=t.id AND s.category='backlog'
    WHERE t.id=? AND t.workspace_id=? AND t.archived_at IS NULL ORDER BY s.position,s.id LIMIT 1`,
    )
    .bind(teamId, workspaceId)
    .first<{ id: string; identifier_prefix: string; status_id: string }>();
  if (!row)
    throw new IssueMutationError(
      "invalid_option",
      "Choose an available team in this workspace with a Backlog status.",
    );
  return row;
}
export async function mapCopyValues(
  db: D1Database,
  source: CopySource,
  teamId: string,
  workspace: string,
) {
  const dropped: DroppedCopyValue[] = [];
  const drop = (field: string, value: unknown, reason: string) =>
    dropped.push({ identifier: source.identifier, field, value, reason });
  const labels = source.labels;
  // A source read is already workspace scoped; recheck every shared value at
  // commit too, so deletion/administration cannot silently strip a copy.
  let cycleId = source.cycle_id;
  if (cycleId && source.team_id !== teamId) {
    drop("cycleId", cycleId, "Cycles belong to their original team.");
    cycleId = null;
  }
  if (
    cycleId &&
    !(await db
      .prepare(
        "SELECT 1 FROM cycles c JOIN teams t ON t.id=c.team_id WHERE c.id=? AND c.team_id=? AND t.cycles_enabled=1 AND c.closed_at IS NULL",
      )
      .bind(cycleId, teamId)
      .first())
  ) {
    drop("cycleId", cycleId, "The original cycle is closed or unavailable.");
    cycleId = null;
  }
  let projectId = source.project_id;
  if (
    projectId &&
    !(await db
      .prepare("SELECT 1 FROM projects WHERE id=? AND workspace_id=?")
      .bind(projectId, workspace)
      .first())
  ) {
    drop("projectId", projectId, "The original project is unavailable.");
    projectId = null;
  }
  let milestoneId = source.milestone_id;
  if (milestoneId && !(await db.prepare(`SELECT 1 FROM project_milestones m JOIN projects p ON p.id=m.project_id
    WHERE m.id=? AND m.project_id=? AND p.workspace_id=?`).bind(milestoneId, projectId ?? "", workspace).first())) {
    drop("milestoneId", milestoneId, "The original milestone is unavailable for the copied project.");
    milestoneId = null;
  }
  return {
    labels,
    milestoneId,
    cycleId,
    projectId,
    customFields: JSON.parse(source.custom_fields_json) as Record<
      string,
      unknown
    >,
    dropped,
  };
}
