import { z } from "zod";
import { fetchJson, fetchBackgroundJson } from "../../../app/api-client.ts";
import { notificationKinds } from "../schema.ts";
import { slackDirectPreferences } from "../../integrations/slack-dm/schema.ts";
import type { InboxPage } from "../schema.ts";
const kind = z.enum(notificationKinds);
export const countSchema = z.object({
  unreadCount: z.number().int().nonnegative(),
});
export function fetchNotificationCount(_signal?: AbortSignal, { background = false }: { background?: boolean } = {}) {
  // Count generations cancel publication, not this small read-only transport.
  // Mutations and access denials can retire a poll while its HTTP read finishes.
  return background ? fetchBackgroundJson('/api/notifications/count', countSchema) : fetchJson("/api/notifications/count", countSchema);
}
export const subscriptionSchema = z.object({
  following: z.boolean(),
  muted: z.boolean(),
});
export const inboxSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      eventId: z.string(),
      sourceEventKind: z.string().nullable().optional(),
      identifier: z.string(),
      documentId: z.string().nullable().optional(),
      title: z.string(),
      actor: z.string().nullable(),
      causes: z.array(kind),
      createdAt: z.string(),
      readAt: z.string().nullable(),
      snoozedUntil: z.string().nullable().optional(),
      snoozeOnChange: z.boolean().optional(),
      visibleAt: z.string().optional(),
    }),
  ),
  unreadCount: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
});
export function inboxUrl(cursor?: string, snoozed = false) {
  const query = new URLSearchParams();
  if (cursor !== undefined) query.set("cursor", cursor);
  if (snoozed) query.set("snoozed", "true");
  return `/api/notifications${query.size ? `?${query}` : ""}`;
}
export function fetchNotificationInbox(
  cursor?: string,
  snoozed = false,
  background = false,
): Promise<InboxPage> {
  // Retiring an Inbox generation suppresses publication while its read-only
  // HTTP request finishes, including ordinary navigation away from Inbox.
  return background ? fetchBackgroundJson(inboxUrl(cursor, snoozed), inboxSchema) : fetchJson(inboxUrl(cursor, snoozed), inboxSchema);
}
export async function fetchInboxPages(
  pageCount: number,
  snoozed: boolean,
  signal: AbortSignal,
  background = false,
): Promise<InboxPage> {
  signal.throwIfAborted();
  let page = await fetchNotificationInbox(undefined, snoozed, background);
  let items = page.items;
  for (let index = 1; index < pageCount && page.nextCursor; index++) {
    signal.throwIfAborted();
    page = await fetchNotificationInbox(page.nextCursor, snoozed, background);
    items = [...items, ...page.items];
  }
  signal.throwIfAborted();
  return { ...page, items };
}
export async function fetchCurrentInboxPage(
  cursor: string,
  signal: AbortSignal,
  snoozed = false,
): Promise<InboxPage | null> {
  if (signal.aborted) return null;
  try {
    const page = await fetchNotificationInbox(cursor, snoozed);
    return signal.aborted ? null : page;
  } catch (error) {
    if (signal.aborted) return null;
    throw error;
  }
}
export const preferencesSchema = z.object({
  emailEnabled: z.boolean(),
  emailAvailable: z.boolean(),
  mutedKinds: z.array(kind),
  mutedIssues: z.array(z.object({ identifier: z.string(), title: z.string() })),
  deliveries: z.array(
    z.object({
      id: z.string(),
      identifier: z.string(),
      title: z.string(),
      status: z.enum(["failed", "uncertain"]),
      reason: z.string().nullable(),
      attempts: z.number().int().nonnegative(),
      updatedAt: z.string(),
    }),
  ),
  slack: slackDirectPreferences,
});
export const mentionOptionsSchema = z.object({
  operators: z.array(
    z.object({
      id: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
      name: z.string().min(1).max(200),
    }),
  ),
});
