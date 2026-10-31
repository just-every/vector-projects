import { z } from "zod";

export const favoriteKindSchema = z.enum(["issue", "project", "view"]);
const subjectId = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);
const folderId = z.string().regex(/^[a-zA-Z0-9-]{1,64}$/);
const folder = z
  .object({ id: folderId, name: z.string().trim().min(1).max(80) })
  .strict();
const entry = z
  .object({
    kind: favoriteKindSchema,
    subjectId,
    folderId: folderId.nullable(),
  })
  .strict();
export const favoriteWriteSchema = z
  .object({
    expectedVersion: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER - 1),
    folders: z.array(folder).max(30),
    entries: z.array(entry).max(200),
  })
  .strict()
  .superRefine((value, ctx) => {
    const folders = new Set(value.folders.map((folder) => folder.id));
    const entries = new Set(
      value.entries.map((entry) => entry.kind + ":" + entry.subjectId),
    );
    if (
      folders.size !== value.folders.length ||
      entries.size !== value.entries.length ||
      value.entries.some(
        (entry) => entry.folderId !== null && !folders.has(entry.folderId),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Favorites must be unique and use an existing folder.",
      });
  });
export const favoriteSubjectSchema = z.object({
  kind: favoriteKindSchema,
  subjectId,
  title: z.string(),
  href: z.string().startsWith("/app/"),
});
export const favoritesSchema = z.object({
  version: z.number().int().nonnegative(),
  folders: z.array(folder),
  entries: z.array(
    favoriteSubjectSchema.extend({ folderId: folderId.nullable() }),
  ),
  current: favoriteSubjectSchema.nullable().optional(),
});
export type FavoriteSelection = {
  kind: z.output<typeof favoriteKindSchema>;
  key: string;
};
export type FavoriteWrite = z.output<typeof favoriteWriteSchema>;
export type Favorites = z.output<typeof favoritesSchema>;
export type FavoriteSubject = z.output<typeof favoriteSubjectSchema>;
