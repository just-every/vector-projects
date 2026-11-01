import { z } from "zod";
import { createUlid } from "../../shared/ids";
import { cycleCreateSchema } from "./schema";
import { localTimeToInstant } from "./calendar";
import {
  administrationContext,
  ownedRow,
  guard,
  commit,
  audit,
  SettingsError,
} from "./transaction";
export async function createCycle(
  db: D1Database,
  actor: string,
  input: z.infer<typeof cycleCreateSchema>,
) {
  const ctx = await administrationContext(db, actor);
  const team = await ownedRow<{ archived_at: string | null; cycles_enabled: number }>(
    ctx,
    "teams",
    input.teamId,
  );
  if (!team.cycles_enabled) throw new SettingsError("cycles_disabled", "Enable cycles in team Settings before creating a cycle.", 409);
  if (team.archived_at)
    throw new SettingsError(
      "team_archived",
      "Unarchive this team before creating a cycle.",
      409,
    );
  const workspace = await ctx.db
    .prepare("SELECT timezone FROM workspace_settings WHERE id=?")
    .bind(ctx.workspace)
    .first<{ timezone: string }>();
  let startsAt: string, endsAt: string;
  try {
    startsAt = localTimeToInstant(input.startsLocal, workspace!.timezone);
    endsAt = localTimeToInstant(input.endsLocal, workspace!.timezone);
  } catch (error) {
    throw new SettingsError(
      "invalid_local_time",
      (error as Error).message,
      400,
    );
  }
  if (endsAt <= startsAt)
    throw new SettingsError(
      "invalid_cycle_dates",
      "The cycle must end after it starts.",
      400,
    );
  const id = createUlid(new Date(ctx.at));
  await commit(ctx, [
    guard(
      ctx.db,
      "EXISTS(SELECT 1 FROM teams t JOIN workspace_settings w ON w.id=t.workspace_id WHERE t.id=? AND t.workspace_id=? AND t.archived_at IS NULL AND t.cycles_enabled=1 AND w.timezone=?)",
      input.teamId,
      ctx.workspace,
      workspace!.timezone,
    ),
    guard(
      ctx.db,
      "NOT EXISTS(SELECT 1 FROM cycles WHERE team_id=? AND julianday(starts_at)<julianday(?) AND julianday(ends_at)>julianday(?))",
      input.teamId,
      endsAt,
      startsAt,
    ),
    ctx.db
      .prepare(
        "INSERT INTO cycles(id,team_id,name,starts_at,ends_at,capacity,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
      )
      .bind(
        id,
        input.teamId,
        input.name,
        startsAt,
        endsAt,
        input.capacity,
        ctx.at,
        ctx.at,
      ),
    ...audit(ctx, "cycle.created", id, input.name, null, {
      teamId: input.teamId,
      name: input.name,
      startsAt,
      endsAt,
      capacity: input.capacity,
    }),
  ]);
  return id;
}
