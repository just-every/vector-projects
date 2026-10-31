import { z } from "zod";
export const rotationInput = z
  .object({
    startsLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    operatorIds: z
      .array(z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/))
      .min(2)
      .max(50)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Choose each member once.",
      ),
  })
  .strict();
export const rotationView = z.object({
  teamId: z.string(),
  teamName: z.string(),
  timezone: z.string(),
  startsLocal: z.string().nullable(),
  operatorIds: z.array(z.string().nullable()),
  responsible: z.object({ id: z.string(), name: z.string() }).nullable(),
  periodStartsAt: z.string().nullable(),
  nextHandoverAt: z.string().nullable(),
  untouched: z.array(z.object({ identifier: z.string(), title: z.string() })),
});
export const triageView = z.object({
  teams: z.array(rotationView),
  count: z.number().int().nonnegative(),
});
export type RotationView = z.infer<typeof rotationView>;
