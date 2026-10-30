import { z } from "zod";
import { namedLinksSchema } from "../links/schema";

export const discussionSchema = z.object({
  links: namedLinksSchema.shape.links,
  comments: z.array(
    z.object({
      id: z.string(),
      parentId: z.string().nullable(),
      anchor: z.object({ quote: z.string(), start: z.number(), end: z.number(), removed: z.boolean(), documentId: z.string().optional() }).nullable(),
      body: z.string().nullable(),
      version: z.number().int().nonnegative(),
      actor: z.string(),
      imported: z.union([z.boolean(), z.number()]).transform(Boolean).optional(),
      canEdit: z.union([z.boolean(), z.number()]).transform(Boolean),
      canDelete: z.union([z.boolean(), z.number()]).transform(Boolean),
      resolvedAt: z.string().nullable(),
      resolvedBy: z.string().nullable(),
      editedAt: z.string().nullable(),
      deletedAt: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
  files: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      contentType: z.string(),
      bytes: z.number(),
      state: z.enum(["pending", "ready", "failed"]),
      removalPending: z.string().nullable(),
      cleanupError: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});
