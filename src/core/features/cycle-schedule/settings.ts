import type { z } from "zod";
import { createUlid } from "../../shared/ids";
import { cycleScheduleSchema } from "../administration/schema";
import {
  administrationContext,
  ownedRow,
  commit,
  guard,
  audit,
  SettingsError,
} from "../administration/transaction";
import { maintainCycleSchedules } from "./service";
export async function saveCycleSchedule(
  db: D1Database,
  actor: string,
  teamId: string,
  input: z.infer<typeof cycleScheduleSchema>,
) {
  const ctx = await administrationContext(db, actor);
  const team = await ownedRow<{ archived_at: string | null; cycles_enabled: number }>(
    ctx,
    "teams",
    teamId,
  );
  if (!team.cycles_enabled) throw new SettingsError("cycles_disabled", "Enable cycles in team Settings before changing its schedule.", 409);
  if (team.archived_at)
    throw new SettingsError(
      "team_archived",
      "Unarchive the team before changing its schedule.",
      409,
    );
  const previous = await ctx.db
    .prepare("SELECT * FROM team_cycle_schedules WHERE team_id=?")
    .bind(teamId)
    .first();
  await commit(ctx, [
    guard(ctx.db, "EXISTS(SELECT 1 FROM teams WHERE id=? AND cycles_enabled=1 AND archived_at IS NULL)", teamId),
    ctx.db
      .prepare(
        `INSERT INTO team_cycle_schedules(team_id,weeks,start_weekday,cooldown_weeks,upcoming_count,revision,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(team_id) DO UPDATE SET weeks=excluded.weeks,start_weekday=excluded.start_weekday,cooldown_weeks=excluded.cooldown_weeks,upcoming_count=excluded.upcoming_count,revision=excluded.revision,updated_at=excluded.updated_at`,
      )
      .bind(
        teamId,
        input.weeks,
        input.startWeekday,
        input.cooldownWeeks,
        input.upcomingCount,
        createUlid(new Date(ctx.at)),
        ctx.at,
      ),
    ...audit(ctx, "cycle.schedule.updated", teamId, teamId, previous, input),
  ]);
  await maintainCycleSchedules({ DB: ctx.db }, new Date(ctx.at), teamId);
}
