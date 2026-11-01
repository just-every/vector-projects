import { z } from 'zod'
import { roles } from '../features/roles/matrix'

export const workspaceOptionsSchema = z.object({
  labelsPerIssue: z.number(),
  canCreateLabels: z.boolean(),
  savedViewsPerOperator: z.number(),
  bulkEditIssuesPerOperation: z.number(),
  workspace: z.object({ id: z.string(), name: z.string() }),
  operator: z.object({ id: z.string(), role:z.enum(roles) }),
  teams: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      identifierPrefix: z.string(),
      cyclesEnabled: z.boolean(),
    }),
  ),
  operators: z.array(z.object({ id: z.string(), name: z.string() })),
  labels: z.array(
    z.object({ id: z.string(), name: z.string(), color: z.string() }),
  ),
  projects: z.array(
    z.object({ id: z.string(), name: z.string(), lifecycle: z.string() }),
  ),
  milestones: z.array(z.object({ id: z.string(), projectId: z.string(), name: z.string(), completed: z.boolean() })),
  statuses: z.array(
    z.object({
      id: z.string(),
      teamId: z.string(),
      name: z.string(),
      category: z.string(),
      position: z.number(),
    }),
  ),
  cycles: z.array(
    z.object({
      id: z.string(),
      teamId: z.string(),
      name: z.string(),
      startsAt: z.string(),
      endsAt: z.string(),
    }),
  ),
  savedViews: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      isShared: z.boolean(),
      surface: z.string(),
    }),
  ),
})

export type WorkspaceOptions = z.output<typeof workspaceOptionsSchema>
