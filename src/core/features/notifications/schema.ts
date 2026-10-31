/** Client-safe collaboration DTOs. */
import type { SlackDirectPreferences } from "../integrations/slack-dm/schema";
export const notificationKinds = [
  "assignment",
  "mention",
  "comment",
  "thread_reopened",
  "intake_return",
  "unblocked",
  "due_reminder",
  "status",
  "completed",
  "canceled",
  "duplicate",
  "archived",
  "urgent",
  "blocking",
  "due_changed",
  "reminder",
] as const;
export type NotificationKind = (typeof notificationKinds)[number];
export type InboxItem = {
  sourceEventKind?: string | null;
  id: string;
  eventId: string;
  identifier: string;
  documentId?: string | null;
  title: string;
  actor: string | null;
  causes: NotificationKind[];
  createdAt: string;
  readAt: string | null;
  snoozedUntil?: string | null;
  snoozeOnChange?: boolean;
  visibleAt?: string;
};
export type InboxPage = {
  items: InboxItem[];
  unreadCount: number;
  nextCursor: string | null;
};
export type IssueSubscription = { following: boolean; muted: boolean };
export type NotificationPreferences = {
  emailEnabled: boolean;
  emailAvailable: boolean;
  mutedKinds: NotificationKind[];
  mutedIssues: { identifier: string; title: string }[];
  deliveries: {
    id: string;
    identifier: string;
    title: string;
    status: "failed" | "uncertain";
    reason: string | null;
    attempts: number;
    updatedAt: string;
  }[];
};
/** Settings → Notifications: the member's own preferences and Slack direct messages (SLACK-004). */
export type NotificationSettings = NotificationPreferences & { slack: SlackDirectPreferences };
