import { z } from "zod";
export const dueRuleInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    enabled: z.boolean(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();
export const dueRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  ownerId: z.string().nullable(),
  ownerName: z.string().nullable(),
  // Admission requires the owner to remain an active Owner or Admin.
  ownerActive: z.boolean(),
  enabled: z.boolean(),
  version: z.number(),
});
export const dueRulesSchema = z.object({
  rule: dueRuleSchema.nullable(),
  runs: z.array(
    z.object({
      id: z.string(),
      identifier: z.string(),
      dueDate: z.string(),
      outcome: z.string(),
      reason: z.string().nullable(),
      failureReason: z.string().nullable(),
      failedAt: z.string().nullable(),
      cycleName: z.string().nullable(),
      notified: z.boolean(),
      at: z.string(),
    }),
  ),
});
export type DueRule = z.infer<typeof dueRuleSchema>;
