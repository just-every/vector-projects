import { z } from 'zod';
import { descriptionAnchorSchema } from '../discussion/anchors';

export const commentDraftSchema = z.object({
  id: z.string(), revision: z.number().int().positive(), body: z.string(),
  identifier: z.string(), parentId: z.string().nullable(), anchor: descriptionAnchorSchema.nullable(),
  team: z.string(), updatedAt: z.string(),
});
export const commentDraftsSchema = z.object({ drafts: z.array(commentDraftSchema) });
export const commentDraftReceiptSchema = z.object({ draft: commentDraftSchema.nullable() });
export const draftIdSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);
// A quoted description comment keeps its selection; it starts a thread, never a reply.
export const commentDraftWriteSchema = z.object({ body: z.string().max(100_000), revision: z.number().int().positive(),
  anchor: descriptionAnchorSchema.optional() }).strict();
export const commentDraftCreateSchema = z.object({ id: draftIdSchema, body: z.string().max(100_000), parentId: draftIdSchema.optional(),
  anchor: descriptionAnchorSchema.optional() }).strict().refine(input => !(input.parentId && input.anchor), 'A quoted comment starts its own thread.');
export type CommentDraft = z.output<typeof commentDraftSchema>;
