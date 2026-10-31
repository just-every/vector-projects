import { z } from 'zod';

export const exportResources = ['issues', 'history', 'cycles', 'projects'] as const;
export type ExportResource = typeof exportResources[number];
export const exportQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(2048).optional(),
  team: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/).optional(),
}).strict();
export type ExportQuery = z.output<typeof exportQuery>;
