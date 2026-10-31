import { loadRotation, eligible } from "./rotation";
import type { RotationView } from "./schema";
import { settingsActor, SettingsError } from "../settings/repository";
export async function rotationProjection(
  db: D1Database,
  actor: string,
  teamId: string,
  now = new Date(),
): Promise<RotationView> {
  const person = await settingsActor(db, actor);
  const team = await db
    .prepare(
      "SELECT id,name FROM teams WHERE id=? AND workspace_id=? AND archived_at IS NULL",
    )
    .bind(teamId, person.workspace_id)
    .first<{ id: string; name: string }>();
  if (!team)
    throw new SettingsError("not_found", "The team is unavailable.", 404);
  const rotation = await loadRotation(db, teamId, now);
  const timezone = await db
    .prepare("SELECT timezone FROM workspace_settings WHERE id=?")
    .bind(person.workspace_id)
    .first<string>("timezone");
  const responsible = rotation?.recipient
    ? await db
        .prepare(
          `SELECT o.id,o.name FROM operators o JOIN teams t ON t.workspace_id=o.workspace_id
  WHERE t.id=? AND o.id=? AND ${eligible}`,
        )
        .bind(teamId, rotation.recipient)
        .first<{ id: string; name: string }>()
    : null;
  const untouched = (
    await db
      .prepare(
        `SELECT i.identifier,i.title FROM issues i JOIN workflow_statuses s ON s.id=i.status_id
  WHERE i.team_id=? AND s.category='intake' AND i.archived_at IS NULL AND i.deferred_until IS NULL
  AND NOT EXISTS(SELECT 1 FROM intake_decisions d WHERE d.issue_id=i.id) ORDER BY i.created_at,i.id`,
      )
      .bind(teamId)
      .all<{ identifier: string; title: string }>()
  ).results;
  await settingsActor(db, actor);
  return {
    teamId,
    teamName: team.name,
    timezone: timezone!,
    startsLocal: rotation?.starts_local ?? null,
    operatorIds: rotation?.members ?? [],
    responsible,
    periodStartsAt: rotation?.period?.startsAt ?? null,
    nextHandoverAt: rotation?.period?.nextAt ?? null,
    untouched,
  };
}
export async function triageProjection(
  db: D1Database,
  actor: string,
  now = new Date(),
) {
  const person = await settingsActor(db, actor);
  const ids = (
    await db
      .prepare(
        `SELECT t.id FROM teams t JOIN team_triage_rotations r ON r.team_id=t.id WHERE t.workspace_id=? AND t.archived_at IS NULL ORDER BY t.name,t.id`,
      )
      .bind(person.workspace_id)
      .all<{ id: string }>()
  ).results;
  const teams = await Promise.all(
    ids.map((row) => rotationProjection(db, actor, row.id, now)),
  );
  return {
    teams,
    count: teams
      .filter((team) => team.responsible?.id === actor)
      .reduce((n, team) => n + team.untouched.length, 0),
  };
}
