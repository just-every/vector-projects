import { z } from 'zod'
import seed from '../../../../seed.json'
import { createIssueInputSchema } from '../issues/input'

const id=z.string().length(26)
// Only native fields are selected here. Typed custom fields retain FIELD-001's duty.
export const defaultsSchema=z.object({
  title:createIssueInputSchema.shape.title.optional(),description:z.string().max(100000).optional(),
  statusId:id.optional(),priority:z.enum(['none','low','medium','high','urgent']).optional(),
  labelIds:z.array(id).max(seed.limits.labelsPerIssue).refine(ids=>new Set(ids).size===ids.length).optional(),
  assigneeOperatorId:id.nullable().optional(),estimate:z.number().int().min(1).max(100).nullable().optional(),
  projectId:id.nullable().optional(),
}).strict()
export const templateInputSchema=z.object({
  name:z.string().trim().min(1).max(120),teamId:id.nullable().default(null),
  defaults:defaultsSchema.default({}),
  subissues:z.array(defaultsSchema.required({title:true})).max(50).default([]),
}).strict()
export const templateSchema=templateInputSchema.extend({id,version:z.number().int().positive(),canEdit:z.boolean()})
export const templateListSchema=z.object({templates:z.array(templateSchema),teams:z.array(z.object({id,name:z.string(),canManage:z.boolean()})),workspaceAllowed:z.boolean()})
// Final native parsing validates every supplied field after merging, without injecting
// defaults into absent request fields before the template has been considered.
export const templateCreateSchema=z.object({teamId:id,templateId:id,templateVersion:z.number().int().positive()}).passthrough()
export type TemplateInput=z.infer<typeof templateInputSchema>
export type IssueTemplate=z.infer<typeof templateSchema>
