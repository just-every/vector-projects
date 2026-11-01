import {inboxSubjects} from './subjects';
import { settingsActor } from "../settings/repository";
import { requireIssueAccess } from "../issues/access";
import type {
  InboxItem,
  InboxPage,
  IssueSubscription,
  NotificationPreferences,
  NotificationKind,
} from "./schema";
export async function unreadCount(db: D1Database, actor: string) {
  await settingsActor(db, actor);
  return (await db
    .prepare(
      `SELECT count(*) n FROM (${inboxSubjects}) WHERE readAt IS NULL AND snoozed=0`,
    )
    .bind(actor,actor)
    .first<number>("n"))!;
}
export async function inbox(
  db: D1Database,
  actor: string,
  limit: number,
  cursor?: { at: string; id: string },
  snoozed = false,
): Promise<InboxPage> {
  await settingsActor(db, actor);
  const rows = (
    await db
      .prepare(
        `SELECT id,eventId,identifier,title,documentId,actor,sourceEventKind,causesJson,createdAt,readAt,snoozedUntil,snoozeOnChange,visibleAt
     FROM (${inboxSubjects}) WHERE snoozed=${snoozed ? 1 : 0}
     ${cursor ? "AND (visibleAt<? OR (visibleAt=? AND id<?))" : ""}
     ORDER BY visibleAt DESC,id DESC LIMIT ?`,
      )
      .bind(
        actor,actor,
        ...(cursor ? [cursor.at, cursor.at, cursor.id] : []),
        limit + 1,
      )
      .all<Omit<InboxItem, "causes"> & { causesJson: string }>()
  ).results;
  const more = rows.length > limit,
    page = rows.slice(0, limit),
    last = page.at(-1);
  const result = {
    items: page.map(({ causesJson, sourceEventKind, ...row }) => ({
      ...(sourceEventKind==="issue.created"&&(JSON.parse(causesJson) as string[]).includes("status")?{sourceEventKind}:{}),
      ...row,
      snoozeOnChange: !!row.snoozeOnChange,
      causes: JSON.parse(causesJson) as NotificationKind[],
    })),
    unreadCount: await unreadCount(db, actor),
    nextCursor:
      more && last
        ? btoa(JSON.stringify({ at: last.visibleAt, id: last.id }))
        : null,
  };
  await settingsActor(db, actor);
  return result;
}
export async function subscription(
  db: D1Database,
  actor: string,
  identifier: string,
): Promise<IssueSubscription> {
  const issue = await requireIssueAccess(db, identifier, actor);
  const result = await subscriptionProjection(db, issue.id, actor);
  await requireIssueAccess(db, identifier, actor);
  return result;
}

/** Read the DTO after the caller has admitted this issue; the caller owns its final fence. */
export async function subscriptionProjection(
  db: D1Database,
  issueId: string,
  actor: string,
): Promise<IssueSubscription> {
  const result = await subscriptionStatement(db, issueId, actor).first<SubscriptionRow>();
  return subscriptionFromRow(result!);
}

export type SubscriptionRow = { following: number; muted: number };

export function subscriptionStatement(db: D1Database, issueId: string, actor: string) {
  return db
    .prepare(
      `SELECT EXISTS(SELECT 1 FROM issue_followers WHERE issue_id=? AND operator_id=?) following,
    EXISTS(SELECT 1 FROM issue_notification_mutes WHERE issue_id=? AND operator_id=?) muted`,
    )
    .bind(issueId, actor, issueId, actor);
}

export function subscriptionFromRow(result: SubscriptionRow): IssueSubscription {
  return { following: !!result.following, muted: !!result.muted };
}
export async function preferences(
  db: D1Database,
  actor: string,
  emailAvailable: boolean,
): Promise<NotificationPreferences> {
  await settingsActor(db, actor);
  const [email, types, issues, deliveries] = await Promise.all([
    db
      .prepare(
        "SELECT email_enabled FROM notification_preferences WHERE operator_id=?",
      )
      .bind(actor)
      .first<number>("email_enabled"),
    db
      .prepare(
        "SELECT kind FROM notification_type_mutes WHERE operator_id=? ORDER BY kind",
      )
      .bind(actor)
      .all<{ kind: NotificationKind }>(),
    db
      .prepare(
        "SELECT i.identifier,i.title FROM issue_notification_mutes m JOIN issues i ON i.id=m.issue_id JOIN teams t ON t.id=i.team_id JOIN operators o ON o.id=m.operator_id AND o.workspace_id=t.workspace_id WHERE m.operator_id=? ORDER BY i.identifier",
      )
      .bind(actor)
      .all<{ identifier: string; title: string }>(),
    db
      .prepare(
        `SELECT d.id,d.identifier,d.title,d.status,d.reason,d.attempts,d.updated_at updatedAt FROM notification_deliveries d JOIN notifications n ON n.id=d.notification_id JOIN issues i ON i.id=n.issue_id JOIN teams t ON t.id=i.team_id JOIN operators o ON o.id=d.recipient_id AND o.workspace_id=t.workspace_id WHERE d.recipient_id=? AND d.status IN ('failed','uncertain') ORDER BY d.updated_at DESC,d.id DESC LIMIT 50`,
      )
      .bind(actor)
      .all<NotificationPreferences["deliveries"][number]>(),
  ]);
  await settingsActor(db, actor);
  return {
    emailEnabled: email === null || email === 1,
    emailAvailable,
    mutedKinds: types.results.map((r) => r.kind),
    mutedIssues: issues.results,
    deliveries: deliveries.results,
  };
}
