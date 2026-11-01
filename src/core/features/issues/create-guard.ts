import type { CreateIssueInput } from "./input";
import { IssueMutationError } from "./errors";
import { isMutationAccessError } from "../auth/mutation-database";

export function creationGuard(
  db: D1Database,
  actor: string,
  workspace: string,
  teamId: string,
  statusId: string,
  input: Pick<CreateIssueInput, "projectId" | "cycleId" | "labelIds"> & { milestoneId?: string | null },
  category: string,
  allocatedPrefix: string,
) {
  // Reservation and persistence are separate transactions. Before a team's
  // first issue, its prefix may change between them; reject the stale allocation
  // inside the same batch that writes the issue and its related records.
  const conditions = [
    `EXISTS(SELECT 1 FROM teams t JOIN operators o ON o.workspace_id=t.workspace_id WHERE t.id=? AND t.workspace_id=? AND t.identifier_prefix=? COLLATE BINARY AND t.archived_at IS NULL AND o.id=? AND o.removed_at IS NULL)`,
    `EXISTS(SELECT 1 FROM workflow_statuses WHERE id=? AND team_id=? AND category=?)`,
  ];
  const values: (string | number)[] = [
    teamId,
    workspace,
    allocatedPrefix,
    actor,
    statusId,
    teamId,
    category,
  ];
  if (input.projectId) {
    conditions.push(
      "EXISTS(SELECT 1 FROM projects WHERE id=? AND workspace_id=? AND archived_at IS NULL)",
    );
    values.push(input.projectId, workspace);
  }
  if (input.milestoneId) {
    conditions.push("EXISTS(SELECT 1 FROM project_milestones m JOIN projects p ON p.id=m.project_id WHERE m.id=? AND m.project_id=? AND p.workspace_id=?)");
    values.push(input.milestoneId, input.projectId ?? "", workspace);
  }
  if (input.cycleId) {
    conditions.push(
      `EXISTS(SELECT 1 FROM cycles c JOIN teams t ON t.id=c.team_id WHERE c.id=? AND c.team_id=? AND t.cycles_enabled=1 AND c.closed_at IS NULL) AND EXISTS(SELECT 1 FROM workflow_statuses WHERE id=? AND category NOT IN ('completed','canceled','duplicate'))`,
    );
    values.push(input.cycleId, teamId, statusId);
  }
  for (const id of input.labelIds) {
    conditions.push(
      "EXISTS(SELECT 1 FROM labels WHERE id=? AND workspace_id=?)",
    );
    values.push(id, workspace);
  }
  return db
    .prepare(
      `SELECT CASE WHEN ${conditions.join(" AND ")} THEN 1 ELSE json('creation option unavailable') END`,
    )
    .bind(...values);
}
export async function creationError(
  db: D1Database,
  team: string,
  error: unknown,
  archiveConflict = false,
): Promise<never> {
  if (isMutationAccessError(error)) throw error;
  if (
    (
      await db
        .prepare("SELECT archived_at FROM teams WHERE id=?")
        .bind(team)
        .first<{ archived_at: string | null }>()
    )?.archived_at
  )
    throw new IssueMutationError(
      archiveConflict ? "invalid_transition" : "invalid_option",
      "This team is archived and no longer available. Unarchive it before adding work.",
    );
  if (/malformed JSON|creation option unavailable/.test(String(error)))
    throw new IssueMutationError(
      "invalid_option",
      "A selected option became unavailable. Refresh and choose again.",
    );
  throw error;
}

/** Reserve only for an active same-workspace team. Reservations remain durable
 * when later issue persistence fails, so an attempted identifier is never reused. */
export async function allocateIssueSequence(
  db: D1Database,
  actor: string,
  workspace: string,
  team: string,
  at: string,
) {
  const eligibility = `EXISTS(SELECT 1 FROM teams t JOIN operators o ON o.workspace_id=t.workspace_id WHERE t.id=? AND t.workspace_id=? AND t.archived_at IS NULL AND o.id=? AND o.removed_at IS NULL)`;
  const row = await db
    .prepare(
      `INSERT INTO team_issue_sequences(team_id,last_sequence,updated_at)
    SELECT t.id,COALESCE((SELECT s.last_sequence FROM issue_prefix_sequences s WHERE s.workspace_id=t.workspace_id AND s.identifier_prefix=t.identifier_prefix),0)+1,?
    FROM teams t WHERE t.id=? AND ${eligibility}
    ON CONFLICT(team_id) DO UPDATE SET last_sequence=excluded.last_sequence,updated_at=excluded.updated_at WHERE ${eligibility}
    RETURNING last_sequence AS sequence,(SELECT identifier_prefix FROM teams WHERE id=team_id) AS prefix`,
    )
    .bind(at, team, team, workspace, actor, team, workspace, actor)
    .first<{ sequence: number; prefix: string }>();
  if (!row)
    return creationError(
      db,
      team,
      new IssueMutationError(
        "invalid_option",
        "The team or operator is no longer available.",
      ),
    );
  return row;
}
