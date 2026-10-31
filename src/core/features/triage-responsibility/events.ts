import { loadRotation, eligible } from "./rotation";
import { visibleRecipient } from "../notifications/events";
import { guard } from "../administration/transaction";
/** Creation and its consumed receipt share the producer's transaction. A mute,
 * absent member or actor consumes this event too; later ticks cannot replay it. */
export async function triageCreationStatements(
  db: D1Database,
  event: {
    id: string;
    issueId: string;
    actor: string | null;
    actorName?: string | null;
    at: string;
  },
  teamId: string,
) {
  const rotation = await loadRotation(db, teamId, new Date(event.at));
  if (!rotation?.period) return [];
  const { period, recipient } = rotation;
  return [
    guard(
      db,
      `EXISTS(SELECT 1 FROM team_triage_rotations r JOIN teams t ON t.id=r.team_id JOIN workspace_settings w ON w.id=t.workspace_id WHERE r.team_id=? AND r.revision=? AND w.timezone=?)`,
      teamId,
      rotation.revision,
      rotation.timezone,
    ),
    db
      .prepare(
        `INSERT INTO triage_creation_receipts(issue_id,event_id,recipient_id,period_starts_at,created_at)
   SELECT i.id,?,?,?,? FROM issues i JOIN issue_activity a ON a.issue_id=i.id WHERE i.id=? AND a.id=? AND a.kind='issue.created'`,
      )
      .bind(
        event.id,
        recipient,
        period.startsAt,
        event.at,
        event.issueId,
        event.id,
      ),
    db
      .prepare(
        `INSERT OR IGNORE INTO notification_candidates(event_id,issue_id,recipient_id,kind,actor_id,actor_name,created_at)
   SELECT r.event_id,i.id,o.id,'triage',?,COALESCE((SELECT name FROM operators WHERE id=?),?),? FROM triage_creation_receipts r JOIN issues i ON i.id=r.issue_id
   JOIN teams t ON t.id=i.team_id JOIN operators o ON o.id=r.recipient_id AND o.workspace_id=t.workspace_id
   WHERE r.event_id=? AND ${eligible} AND ${visibleRecipient} AND (o.id<>? OR ? IS NULL)
   AND NOT EXISTS(SELECT 1 FROM notification_events e WHERE e.event_id=r.event_id)
   AND NOT EXISTS(SELECT 1 FROM vector_restore_status WHERE effects_held=1)
   AND NOT EXISTS(SELECT 1 FROM rer_portability_state WHERE applying=1)`,
      )
      .bind(
        event.actor,
        event.actor,
        event.actorName ?? null,
        event.at,
        event.id,
        event.actor,
        event.actor,
      ),
  ];
}
