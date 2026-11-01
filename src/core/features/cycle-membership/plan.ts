import { createUlid } from "../../shared/ids";

/** Plan only for native transitions. Imports and archive restore never call this. */
export async function planAutomaticCycle(db: D1Database, teamId: string, cycleId: string | null,
  fromCategory: string | null, category: string, at: string) {
  if (cycleId || category === fromCategory || !["started", "completed"].includes(category)) return null;
  const flag = category === "started" ? "auto_cycle_started" : "auto_cycle_completed";
  const row = await db.prepare(`SELECT c.id FROM cycles c JOIN teams t ON t.id=c.team_id
    WHERE c.team_id=? AND t.archived_at IS NULL AND t.cycles_enabled=1 AND t.${flag}=1 AND c.closed_at IS NULL
      AND c.starts_at<=? AND c.ends_at>? ORDER BY c.starts_at,c.id LIMIT 1`)
    .bind(teamId, at, at).first<{ id: string }>();
  if (!row) return null;
  return { cycleId: row.id, condition: `EXISTS(SELECT 1 FROM cycles c JOIN teams t ON t.id=c.team_id
    WHERE c.id=? AND c.team_id=? AND t.archived_at IS NULL AND t.cycles_enabled=1 AND t.${flag}=1 AND c.closed_at IS NULL
      AND c.starts_at<=? AND c.ends_at>?)`, values: [row.id, teamId, at, at] };
}

export function automaticCycleStatements(db: D1Database, issueId: string, cycleId: string,
  at: string, where: string, values: (string | number)[]) {
  const activityId = createUlid(new Date(at));
  return [db.prepare(`INSERT INTO issue_activity(id,issue_id,actor_operator_id,actor_name,kind,previous_value_json,next_value_json,created_at,updated_at)
    SELECT ?,id,NULL,'Cycle membership automation','issue.cycle_automatically_added',json_object('cycleId',NULL),json_object('cycleId',?,'feature','cycle.membership.v1'),?,?
    FROM issues WHERE ${where}`).bind(activityId, cycleId, at, at, ...values),
    db.prepare(`INSERT INTO audit_records(id,actor_operator_id,action,subject_identifier,subject_id,created_at,updated_at)
      SELECT ?,NULL,'cycle.membership.v1',identifier,id,?,? FROM issues WHERE id=? AND EXISTS(SELECT 1 FROM issue_activity WHERE id=?)`)
      .bind(activityId, at, at, issueId, activityId)];
}
