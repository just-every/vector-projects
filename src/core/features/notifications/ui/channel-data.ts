import { z } from "zod";
import { channelChoiceSchema } from "../channel-schema";

export const channelDefaultsSchema = z.object({
  channels: z.array(channelChoiceSchema),
});

export const channelPreferencesSchema = z.object({
  channels: z.array(channelChoiceSchema.extend({ inherited: z.boolean() })),
  defaults: z.array(channelChoiceSchema),
  canManageDefaults: z.boolean(),
  digestDeliveries: z.array(z.object({
    id: z.string(),
    status: z.enum(["failed", "uncertain"]),
    attempts: z.number().int().nonnegative(),
    updatedAt: z.string(),
    reason: z.string().nullable(),
  })),
});

export const channelLabels = {
  assignment: "Assignments",
  mention: "Mentions",
  comment: "Followed comments",
  thread_reopened: "Reopened threads",
  triage: "Triage responsibility",
  intake_return: "Deferred intake returns",
  unblocked: "Last blocker resolved",
  due_reminder: "Due reminders",
  status: "Followed status changes",
  completed: "Followed issues completed",
  canceled: "Followed issues canceled",
  duplicate: "Followed issues marked duplicate",
  archived: "Followed issues archived",
  urgent: "Followed issues raised to Urgent",
  blocking: "Followed blocking changes",
  due_changed: "Followed due date changes",
  reminder: "Personal reminders",
};
