import { mutationDatabase } from "../auth/mutation-database";
import { requireIssueAccess } from "../issues/access";
import { SettingsError, settingsActor } from "../settings/repository";
import type { NotificationKind } from "./schema";
export async function markRead(db: D1Database, actor: string, id?: string) {
  db = mutationDatabase(db, actor);
  const at = new Date().toISOString();
  const result = await db.batch([
    db.prepare(
      `UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE recipient_id=? AND EXISTS(SELECT 1 FROM issues i JOIN teams t ON t.id=i.team_id JOIN operators o ON o.workspace_id=t.workspace_id WHERE i.id=notifications.issue_id AND o.id=notifications.recipient_id) ${id ? "AND id=?" : ""}`,
    )
    .bind(at, actor, ...(id ? [id] : [])),
    db.prepare(`UPDATE document_notifications SET read_at=COALESCE(read_at,?)
      WHERE recipient_id=? AND document_id IN(SELECT id FROM documents) ${id ? 'AND id=?' : ''}`)
      .bind(at,actor,...(id?[id]:[])),
  ]);
  if (id && result.every(row=>row.meta.changes === 0))
    throw new SettingsError("not_found", "Notification is unavailable.", 404);
}
export async function changeSubscription(
  db: D1Database,
  actor: string,
  identifier: string,
  values: { following?: boolean; muted?: boolean },
) {
  db = mutationDatabase(db, actor);
  const issue = await requireIssueAccess(db, identifier, actor);
  const writes: D1PreparedStatement[] = [
    db
      .prepare(
        `SELECT CASE WHEN EXISTS(SELECT 1 FROM issues i JOIN teams t ON t.id=i.team_id JOIN operators o ON o.workspace_id=t.workspace_id WHERE i.id=? AND o.id=? AND o.removed_at IS NULL) THEN 1 ELSE json('subscription unavailable') END`,
      )
      .bind(issue.id, actor),
  ];
  if (values.following !== undefined)
    writes.push(
      values.following
        ? db
            .prepare(
              "INSERT OR IGNORE INTO issue_followers(issue_id,operator_id,created_at) VALUES(?,?,?)",
            )
            .bind(issue.id, actor, new Date().toISOString())
        : db
            .prepare(
              "DELETE FROM issue_followers WHERE issue_id=? AND operator_id=?",
            )
            .bind(issue.id, actor),
    );
  if (values.muted !== undefined)
    writes.push(
      values.muted
        ? db
            .prepare(
              "INSERT OR IGNORE INTO issue_notification_mutes(issue_id,operator_id) VALUES(?,?)",
            )
            .bind(issue.id, actor)
        : db
            .prepare(
              "DELETE FROM issue_notification_mutes WHERE issue_id=? AND operator_id=?",
            )
            .bind(issue.id, actor),
    );
  await db.batch(writes);
}
export async function changePreferences(
  db: D1Database,
  actor: string,
  values: { emailEnabled?: boolean; mutedKinds?: NotificationKind[] },
) {
  db = mutationDatabase(db, actor);
  await settingsActor(db, actor);
  const writes: D1PreparedStatement[] = [];
  if (values.emailEnabled !== undefined)
    writes.push(
      db
        .prepare(
          "INSERT INTO notification_preferences(operator_id,email_enabled) VALUES(?,?) ON CONFLICT(operator_id) DO UPDATE SET email_enabled=excluded.email_enabled",
        )
        .bind(actor, values.emailEnabled ? 1 : 0),
    );
  if (values.mutedKinds !== undefined)
    writes.push(
      db
        .prepare("DELETE FROM notification_type_mutes WHERE operator_id=?")
        .bind(actor),
      db
        .prepare(
          "INSERT INTO notification_type_mutes(operator_id,kind) SELECT ?,value FROM json_each(?)",
        )
        .bind(actor, JSON.stringify(values.mutedKinds)),
    );
  await db.batch(writes);
}
