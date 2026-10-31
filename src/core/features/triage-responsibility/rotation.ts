import { rotationPeriod } from "./calendar";
import { activeRecipient } from "../notifications/events";
type Rotation = {
  team_id: string;
  starts_local: string;
  revision: string;
  timezone: string;
};
export const eligible = `${activeRecipient} AND o.role IN('owner','admin','member') AND EXISTS(SELECT 1 FROM team_members member WHERE member.team_id=t.id AND member.operator_id=o.id)`;
export async function loadRotation(db: D1Database, teamId: string, now: Date) {
  const row = await db
    .prepare(
      `SELECT r.*,w.timezone FROM team_triage_rotations r JOIN teams t ON t.id=r.team_id
  JOIN workspace_settings w ON w.id=t.workspace_id WHERE t.id=? AND t.archived_at IS NULL`,
    )
    .bind(teamId)
    .first<Rotation>();
  if (!row) return null;
  const members = (
    await db
      .prepare(
        "SELECT operator_id FROM team_triage_rotation_members WHERE team_id=? ORDER BY position",
      )
      .bind(teamId)
      .all<{ operator_id: string | null }>()
  ).results.map((r) => r.operator_id);
  const period = members.length
    ? rotationPeriod(row.starts_local, row.timezone, members.length, now)
    : null;
  return {
    ...row,
    members,
    period,
    recipient: period ? members[period.position] : null,
  };
}
