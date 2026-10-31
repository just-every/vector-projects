import { createUlid } from "../../shared/ids";
import { guard } from "../administration/transaction";
import { nextInterval, afterCooldown } from "./calendar";

type Schedule = {
  team_id: string;
  weeks: number;
  start_weekday: number;
  cooldown_weeks: number;
  upcoming_count: number;
  revision: string;
  generation: number;
  timezone: string;
};
type Cycle = {
  id: string;
  starts_at: string;
  ends_at: string;
  schedule_revision: string | null;
  closed_at: string | null;
};
/** Fill the future horizon before closure discovers its rollover destination. */
export async function maintainCycleSchedules(
  env: { DB: D1Database },
  now = new Date(),
  teamId?: string,
) {
  const db = env.DB,
    at = now.toISOString();
  const schedules = (
    await db
      .prepare(
        `SELECT s.*,w.timezone FROM team_cycle_schedules s JOIN teams t ON t.id=s.team_id JOIN workspace_settings w ON w.id=t.workspace_id WHERE t.archived_at IS NULL AND t.cycles_enabled=1 ${teamId ? "AND t.id=?" : ""}`,
      )
      .bind(...(teamId ? [teamId] : []))
      .all<Schedule>()
  ).results;
  for (const s of schedules) {
    const cycles = (
      await db
        .prepare(
          "SELECT id,starts_at,ends_at,schedule_revision,closed_at FROM cycles WHERE team_id=? ORDER BY starts_at,id",
        )
        .bind(s.team_id)
        .all<Cycle>()
    ).results;
    const future = cycles.filter((c) => c.starts_at > at && !c.closed_at);
    const pending = future.filter((c) => c.schedule_revision !== null);
    const changed = pending.some((c) => c.schedule_revision !== s.revision);
    if (!changed && future.length >= s.upcoming_count) continue;
    const fixed = changed ? cycles.filter((c) => !pending.includes(c)) : cycles;
    let after = at;
    for (const c of fixed) {
      const boundary = afterCooldown(c.ends_at, s.timezone, s.cooldown_weeks);
      if (boundary > after) after = boundary;
    }
    const writes: D1PreparedStatement[] = [
      guard(
        db,
        "EXISTS(SELECT 1 FROM team_cycle_schedules s JOIN teams t ON t.id=s.team_id JOIN workspace_settings w ON w.id=t.workspace_id WHERE s.team_id=? AND s.revision=? AND s.generation=? AND t.archived_at IS NULL AND t.cycles_enabled=1 AND w.timezone=?)",
        s.team_id,
        s.revision,
        s.generation,
        s.timezone,
      ),
    ];
    const needed = Math.max(0, s.upcoming_count - future.length);
    const slots: (Cycle | null)[] = [
      ...(changed ? pending : []),
      ...Array<Cycle | null>(needed).fill(null),
    ];
    for (const existing of slots) {
      const interval = nextInterval(
        after,
        s.timezone,
        s.start_weekday,
        s.weeks,
      );
      const id = existing?.id ?? createUlid(now);
      if (existing) {
        writes.push(
          db
            .prepare(
              "UPDATE cycles SET starts_at=?,ends_at=?,schedule_revision=?,updated_at=? WHERE id=? AND starts_at>? AND closed_at IS NULL",
            )
            .bind(interval.startsAt, interval.endsAt, s.revision, at, id, at),
        );
      } else {
        writes.push(
          db
            .prepare(
              "INSERT INTO cycles(id,team_id,name,starts_at,ends_at,capacity,schedule_revision,created_at,updated_at) VALUES(?,?,?,?,?,NULL,?,?,?)",
            )
            .bind(
              id,
              s.team_id,
              `Cycle ${interval.startsAt.slice(0, 10)} · ${id.slice(-6)}`,
              interval.startsAt,
              interval.endsAt,
              s.revision,
              at,
              at,
            ),
        );
      }
      const auditId = createUlid(now);
      writes.push(
        db
          .prepare(
            "INSERT INTO audit_records(id,actor_operator_id,action,subject_identifier,subject_id,created_at,updated_at) VALUES(?,NULL,?,?,?, ?,?)",
          )
          .bind(
            auditId,
            existing
              ? "cycle.rescheduled.automation"
              : "cycle.created.automation",
            id,
            id,
            at,
            at,
          ),
      );
      writes.push(
        db
          .prepare(
            "INSERT INTO administration_audit_details(audit_id,previous_value_json,next_value_json) VALUES(?,?,?)",
          )
          .bind(
            auditId,
            JSON.stringify(existing),
            JSON.stringify({
              ...interval,
              teamId: s.team_id,
              automation: "CYCLE-007",
            }),
          ),
      );
      after = afterCooldown(interval.endsAt, s.timezone, s.cooldown_weeks);
    }
    writes.push(
      db
        .prepare(
          "UPDATE team_cycle_schedules SET generation=generation+1 WHERE team_id=? AND revision=? AND generation=?",
        )
        .bind(s.team_id, s.revision, s.generation),
    );
    try {
      await db.batch(writes);
    } catch (error) {
      // Another schedule writer won the conditional transaction. Its horizon
      // is authoritative; the next cron reads it anew.
      if (!/administration conflict|malformed JSON/.test(String(error)))
        throw error;
    }
  }
}
