import { createUlid } from "../../shared/ids";
import { snapshotSql } from "./snapshot-sql";

/** cycle.rollover.v1. Exactly one atomic conditional batch per discovered cycle. */
export async function closeEndedCycles(
  env: { DB: D1Database },
  now = new Date(),
) {
  const db = env.DB,
    at = now.toISOString();
  const candidates = (
    await db
      .prepare(
        `SELECT c.id FROM cycles c JOIN teams t ON t.id=c.team_id WHERE t.cycles_enabled=1 AND c.closed_at IS NULL AND julianday(ends_at)<=julianday(?) ORDER BY julianday(c.ends_at),c.id`,
      )
      .bind(at)
      .all<{ id: string }>()
  ).results;
  let closed = 0;
  for (const { id } of candidates) {
    const token = createUlid(now);
    const owns = `EXISTS(SELECT 1 FROM cycle_snapshots s JOIN cycles c ON c.id=s.cycle_id WHERE s.cycle_id=? AND s.close_token=? AND c.closed_at IS NULL)`;
    const destination = `CASE WHEN (SELECT category FROM workflow_statuses WHERE id=issues.status_id) IN ('unstarted','started') THEN (SELECT next_cycle_id FROM cycle_snapshots WHERE cycle_id=?) ELSE NULL END`;
    const results = await db.batch([
      db.prepare(snapshotSql).bind(id, at, token, at, at),
      db
        .prepare(
          `INSERT INTO issue_activity(id,issue_id,actor_operator_id,actor_name,kind,previous_value_json,next_value_json,created_at,updated_at)
    SELECT ?||':'||id,id,NULL,'Cycle rollover automation','issue.updated',json_object('cycleId',cycle_id),json_object('cycleId',${destination}),?,?
    FROM issues WHERE cycle_id=? AND ${owns}`,
        )
        .bind(token, id, at, at, id, id, token),
      db
        .prepare(
          `INSERT INTO cycle_closure_failures(cycle_id,identifiers_json,created_at)
    SELECT ?,json_group_array(identifier),? FROM (SELECT i.identifier FROM issues i JOIN workflow_statuses s ON s.id=i.status_id
    WHERE i.cycle_id=? AND s.category IN ('unstarted','started') ORDER BY i.identifier)
    WHERE ${owns} AND (SELECT next_cycle_id FROM cycle_snapshots WHERE cycle_id=?) IS NULL HAVING count(*)>0`,
        )
        .bind(id, at, id, id, token, id),
      db
        .prepare(
          `UPDATE issues SET cycle_id=${destination},version=version+1,updated_at=? WHERE cycle_id=? AND ${owns}`,
        )
        .bind(id, at, id, id, token),
      db
        .prepare(
          `INSERT INTO audit_records(id,actor_operator_id,action,subject_identifier,subject_id,created_at,updated_at)
        SELECT ?,NULL,'cycle.closed',?,?,?,? WHERE ${owns}`,
        )
        .bind(token, id, id, at, at, id, token),
      db
        .prepare(
          `UPDATE cycles SET closed_at=?,updated_at=? WHERE id=? AND closed_at IS NULL AND ${owns}`,
        )
        .bind(at, at, id, id, token),
    ]);
    if (results[5].meta.changes) closed++;
  }
  return { closed };
}
