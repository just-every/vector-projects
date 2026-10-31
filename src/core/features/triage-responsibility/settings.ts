import { loadRotation, eligible } from "./rotation";
import { SettingsError } from "../settings/repository";
import {
  administrationContext,
  ownedRow,
  commit,
  audit,
  guard,
} from "../administration/transaction";
import { localTimeToInstant } from "../administration/calendar";
import type { z } from "zod";
import type { rotationInput } from "./schema";
export async function saveRotation(
  db: D1Database,
  actor: string,
  teamId: string,
  input: z.infer<typeof rotationInput>,
) {
  const ctx = await administrationContext(db, actor),
    team = await ownedRow<{ name: string; archived_at: string | null }>(
      ctx,
      "teams",
      teamId,
    );
  if (team.archived_at)
    throw new SettingsError("team_archived", "Unarchive this team first.", 409);
  const timezone = (await db
    .prepare("SELECT timezone FROM workspace_settings WHERE id=?")
    .bind(ctx.workspace)
    .first<string>("timezone"))!;
  try {
    localTimeToInstant(input.startsLocal, timezone);
  } catch (error) {
    throw new SettingsError("invalid_handover", (error as Error).message, 400);
  }
  const previous = await loadRotation(db, teamId, new Date(ctx.at));
  const encoded = JSON.stringify(input.operatorIds);
  await commit(ctx, [
    guard(
      ctx.db,
      `(SELECT count(*) FROM operators o JOIN teams t ON t.workspace_id=o.workspace_id WHERE t.id=? AND o.id IN(SELECT value FROM json_each(?)) AND ${eligible})=?`,
      teamId,
      encoded,
      input.operatorIds.length,
    ),
    ctx.db
      .prepare(
        `INSERT INTO team_triage_rotations(team_id,starts_local,revision,updated_at) VALUES(?,?,?,?)
   ON CONFLICT(team_id) DO UPDATE SET starts_local=excluded.starts_local,revision=excluded.revision,updated_at=excluded.updated_at`,
      )
      .bind(teamId, input.startsLocal, crypto.randomUUID(), ctx.at),
    ctx.db
      .prepare("DELETE FROM team_triage_rotation_members WHERE team_id=?")
      .bind(teamId),
    ...input.operatorIds.map((id, position) =>
      ctx.db
        .prepare(
          "INSERT INTO team_triage_rotation_members(team_id,position,operator_id) VALUES(?,?,?)",
        )
        .bind(teamId, position, id),
    ),
    ...audit(
      ctx,
      "team.triage_rotation.updated",
      teamId,
      team.name,
      previous
        ? { startsLocal: previous.starts_local, operatorIds: previous.members }
        : null,
      input,
    ),
  ]);
}
