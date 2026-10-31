import { z } from 'zod';
import { parseNewIssueDraft, type NewIssueDraft } from '../issues/ui/new-issue-draft';

// Unfinished forms may have an empty title or date. Creation validates the final issue.
export const draftValuesSchema = z.unknown().transform((value, context): NewIssueDraft => {
  const parsed = parseNewIssueDraft(value);
  if (!parsed || parsed.mode !== 'issue' || parsed.teamId.length !== 26 ||
      parsed.title.length > 500 || parsed.description.length > 100_000 ||
      parsed.labelIds.length > 100 || parsed.labelIds.some(id => id.length !== 26) ||
      JSON.stringify(parsed).length > 150_000) {
    context.addIssue({ code: 'custom', message: 'Invalid new issue draft.' });
    return z.NEVER;
  }
  return parsed;
});
export const draftSchema = z.object({
  id: z.string(), revision: z.number().int().positive(), values: draftValuesSchema,
  team: z.string(), updatedAt: z.string(),
});
export const draftsSchema = z.object({ drafts: z.array(draftSchema) });
export const draftReceiptSchema = z.object({ draft: draftSchema.nullable() });
export const draftWriteSchema = z.object({ values: draftValuesSchema, revision: z.number().int().positive().optional() }).strict();
export const draftRevisionSchema = z.object({ revision: z.number().int().positive() }).strict();
export type AccountDraft = z.output<typeof draftSchema>;
export type DraftReference = { id: string; revision: number };
