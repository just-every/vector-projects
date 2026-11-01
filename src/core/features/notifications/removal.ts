/** Product operators are tombstones, so FK cascades alone cannot erase them. */
export function notificationRemovalStatements(
  db: D1Database,
  target: string,
  removalId: string,
) {
  const guard = "EXISTS(SELECT 1 FROM operator_removals WHERE id=?)";
  return [
    ...[
      "issue_reminders",
      "notifications",
      "document_notifications",
      "notification_candidates",
      "notification_deliveries",
    ].map((table) =>
      db
        .prepare(`DELETE FROM ${table} WHERE recipient_id=? AND ${guard}`)
        .bind(target, removalId),
    ),
    ...[
      "issue_followers",
      "document_followers",
      "document_mentions",
      "issue_mentions",
      "issue_notification_mutes",
      "notification_preferences",
      "notification_type_mutes",
      "operator_personal_time",
      "operator_appearance",
    ].map((table) =>
      db
        .prepare(`DELETE FROM ${table} WHERE operator_id=? AND ${guard}`)
        .bind(target, removalId),
    ),
    ...[
      "notifications",
      "document_notifications",
      "notification_candidates",
      "notification_deliveries",
    ].map((table) =>
      db
        .prepare(
          `UPDATE ${table} SET actor_id=NULL,actor_name='Removed operator' WHERE actor_id=? AND ${guard}`,
        )
        .bind(target, removalId),
    ),
  ];
}
