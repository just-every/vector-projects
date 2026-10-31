import type { InboxItem, NotificationKind } from "../schema";

const actions: Record<NotificationKind, string> = {
  assignment: "assigned you",
  mention: "mentioned you on",
  comment: "commented on",
  thread_reopened: "reopened a thread on",
  triage: "sent new triage work to you:",
  intake_return: "returned your deferred intake",
  unblocked: "removed the last blocker from",
  due_reminder: "has a due reminder for",
  status: "changed the status of",
  completed: "completed",
  canceled: "canceled",
  duplicate: "marked duplicate",
  archived: "archived",
  urgent: "raised the priority to Urgent for",
  blocking: "changed a blocking relation on",
  due_changed: "changed the due date of",
  reminder: "has a reminder for",
};

export function notificationAction(item: InboxItem): string {
  if(item.sourceEventKind==="issue.created"&&item.causes.includes("status"))return "created";
  const labels = [...new Set(item.causes)].map((kind) => actions[kind]);
  return labels.length > 1
    ? labels.slice(0, -1).join(", ") + " and " + labels.at(-1)
    : labels.join("");
}
