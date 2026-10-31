import { issueReferenceStatements } from "../issue-references/repository";
import { planAutomaticCycle, automaticCycleStatements } from "../cycle-membership/plan";
import { requireIssueAccess } from './access'
import { followStatements, assignmentStatements, mentionStatements, blockerStatements, followerChangeStatements, finalizeEvent } from '../notifications/events'
import seed from '../../../../seed.json'
import { creationGuard, creationError, allocateIssueSequence } from './create-guard'
import { commitWithAssignee } from "./assignment-commit";
import { mutationDatabase } from "../auth/mutation-database";
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { createUlid } from '../../shared/ids'
import { currentAgentActor, agentActivity } from '../agent-door/attribution'
import {
  cycles,
  intakeDecisions,
  issueActivity,
  issueLabels,
  issues,
  labels,
  operators,
  projects,
  projectMilestones,
  teams,
  workflowStatuses,
} from '../../platform/db/schema'
import { IssueMutationError } from './errors'
import type { AcceptIssueInput, CreateIssueInput, DeclineIssueInput, DeferIssueInput } from './input'

type Database = ReturnType<typeof drizzle>
type WriteOutcome = { outcome: 'written'; identifier: string } | { outcome: 'stale'; identifier: string }
type DecisionState = {
  issueValues: Record<string, string | number | null>
  reason: string | null
  returnAt: string | null
  previousValue: unknown
  nextValue: unknown
}

type CreateIssueRecordInput = {
  actorOperatorId: string
  input: CreateIssueInput
  now: Date
  commitStatements?: (db: D1Database, identifier: string) => D1PreparedStatement[]
}

type IntakeDecisionRecordInput = {
  actorOperatorId: string
  expectedVersion: number
  identifier: string
  input: AcceptIssueInput | DeclineIssueInput | DeferIssueInput
  kind: 'accepted' | 'deferred' | 'declined'
  now: Date
}

export async function createIssueRecord(binding: D1Database, request: CreateIssueRecordInput): Promise<{ identifier: string }> {
  const plan = await planIssueRecord(binding, request)
  try { await mutationDatabase(binding, request.actorOperatorId).batch(plan.writes) }
  catch (error) { return creationError(binding, request.input.teamId, error) }
  return { identifier: plan.identifier }
}

/** Plans native creation, including notifications and references, for one atomic graph write.
 * Sequence reservations remain durable even when persistence is refused. */
export async function planIssueRecord(binding: D1Database, request: CreateIssueRecordInput) {
  binding = mutationDatabase(binding, request.actorOperatorId)
  const db = drizzle(binding)
  const now = request.now.toISOString()
  const [teamResult, statusResult] = await Promise.allSettled([
    requireActiveTeam(db, request.input.teamId),
    request.input.statusId
      ? requireStatus(db, request.input.statusId, request.input.teamId)
      : defaultStatus(db, request.input.teamId, 'backlog'),
  ])
  // Preserve validation precedence while reading independent options together.
  if (teamResult.status === 'rejected') throw teamResult.reason
  if (statusResult.status === 'rejected') throw statusResult.reason
  const team = teamResult.value, status = statusResult.value
  if (!['backlog', 'unstarted', 'started', 'completed', 'canceled'].includes(status.category)) {
    throw new IssueMutationError('invalid_option', 'New issues must use a non-Intake, non-Duplicate status.')
  }
  await validateIssueOptions(db, team.workspaceId, team.id, request.input)

  const allocation = await allocateIssueSequence(binding,request.actorOperatorId,team.workspaceId,team.id,now)
  const sequenceNumber = allocation.sequence
  const identifier = `${allocation.prefix}-${sequenceNumber}`
  const issueId = createUlid(request.now)
  const issueWrite = db.insert(issues).values({
    id: issueId,
    identifier,
    originPrefix: allocation.prefix,
    sequenceNumber,
    teamId: team.id,
    title: request.input.title,
    description: request.input.description,
    statusId: status.id,
    priority: request.input.priority,
    assigneeOperatorId: request.input.assigneeOperatorId,
    projectId: request.input.projectId,
    milestoneId: request.input.milestoneId,
    cycleId: request.input.cycleId,
    startDate: request.input.startDate,
    dueDate: request.input.dueDate,
    estimate: request.input.estimate,
    expectedOutcome: request.input.expectedOutcome,
    customerImpact: request.input.customerImpact,
    customFieldsJson: JSON.stringify(request.input.customFields),
    deferredUntil: null,
    version: 1,
    completedAt: status.category === 'completed' ? now : null,
    canceledAt: status.category === 'canceled' ? now : null,
    createdAt: now,
    updatedAt: now,
  })
  const creationActivity = activityRow({
    issueId,
    actorOperatorId: request.actorOperatorId,
    kind: 'issue.created',
    previousValue: null,
    nextValue: {
      identifier,
      title: request.input.title,
      description: request.input.description,
      teamId: team.id,
      statusId: status.id,
      assigneeOperatorId: request.input.assigneeOperatorId,
      projectId: request.input.projectId,
    milestoneId: request.input.milestoneId,
      cycleId: request.input.cycleId,
      priority: request.input.priority,
      labelIds: request.input.labelIds,
      estimate: request.input.estimate,
      startDate: request.input.startDate,
    dueDate: request.input.dueDate,
      expectedOutcome: request.input.expectedOutcome,
      customerImpact: request.input.customerImpact,
      customFields: request.input.customFields,
    },
    now,
  })
  const activityWrite = db.insert(issueActivity).values(creationActivity)
  const event = { id: creationActivity.id, issueId, actor: request.actorOperatorId, at: now }
  const labelWrites = request.input.labelIds.length === 0
    ? []
    : [db.insert(issueLabels).values(request.input.labelIds.map((labelId) => ({ issueId, labelId, createdAt: now })))]
  const writes = [creationGuard(binding, request.actorOperatorId, team.workspaceId, team.id, status.id, request.input, status.category, allocation.prefix), ...[issueWrite, ...labelWrites, activityWrite].map(query => {
      const { sql, params } = query.toSQL()
      return binding.prepare(sql).bind(...params)
    }), ...followStatements(binding,event,[request.actorOperatorId]), ...assignmentStatements(binding,event,request.input.assigneeOperatorId), ...mentionStatements(binding,event,request.input.description), ...issueReferenceStatements(binding,event,request.input.description), ...finalizeEvent(binding,event), ...(request.commitStatements?.(binding,identifier) ?? [])]
  if (request.input.assigneeOperatorId) writes.unshift(binding.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM operators WHERE id=? AND workspace_id=? AND removed_at IS NULL) THEN 1 ELSE json('assignee unavailable') END").bind(request.input.assigneeOperatorId,team.workspaceId))
  return { identifier, issueId, writes }
}
export async function writeIntakeDecision(binding: D1Database, request: IntakeDecisionRecordInput): Promise<WriteOutcome> {
  binding = mutationDatabase(binding, request.actorOperatorId)
  const db = drizzle(binding)
  const now = request.now.toISOString()
  await requireIssueAccess(binding,request.identifier,request.actorOperatorId)
  const issue = await requireIssue(db, request.identifier)
  if (issue.version !== request.expectedVersion) return { outcome: 'stale', identifier: issue.identifier }

  const team = await requireActiveTeam(db, issue.teamId)
  const currentStatus = await requireStatus(db, issue.statusId, team.id)
  if (currentStatus.category !== 'intake') {
    throw new IssueMutationError('invalid_transition', `Issue ${issue.identifier} is not awaiting an intake decision.`)
  }

  const next = await nextDecisionState(db, team, issue, request)
  const destinationStatus = await requireStatus(db, String(next.issueValues.statusId ?? issue.statusId), team.id)
  const automaticCycle = request.kind === 'accepted' ? await planAutomaticCycle(binding, team.id,
    next.issueValues.cycleId as string | null, currentStatus.category, destinationStatus.category, now) : null
  if (automaticCycle) next.issueValues.cycleId = automaticCycle.cycleId
  const decisionId = createUlid(request.now), activityId = createUlid(request.now)
  const event = { id: activityId, issueId: issue.id, actor: request.actorOperatorId, at: now }
  const decisionWrite = db.insert(intakeDecisions).select(decisionSelection(db, issue.identifier, request, next, now, decisionId))
  const activityWrite = db.insert(issueActivity).select(activitySelection(db, issue.identifier, request, next, now, activityId))
  const issueWrite = db.update(issues).set({ ...next.issueValues, version: issue.version + (automaticCycle ? 2 : 1), updatedAt: now })
    .where(and(eq(issues.identifier, issue.identifier), eq(issues.version, request.expectedVersion)))
    .returning({ id: issues.id })
  const statements = [binding.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM issues i JOIN teams t ON t.id=i.team_id JOIN operators o ON o.workspace_id=t.workspace_id WHERE i.id=? AND o.id=? AND o.removed_at IS NULL) THEN 1 ELSE json('intake access denied') END`).bind(issue.id,request.actorOperatorId), ...[decisionWrite, activityWrite].map(query => {
      const { sql, params } = query.toSQL()
      return binding.prepare(sql).bind(...params)
    })].concat([
      ...blockerStatements(binding,event),
      ...followerChangeStatements(binding,event),
      ...(request.kind === 'accepted' && (request.input as AcceptIssueInput).assigneeOperatorId !== issue.assigneeOperatorId ? assignmentStatements(binding,event,(request.input as AcceptIssueInput).assigneeOperatorId) : []),
      binding.prepare(`DELETE FROM issue_deferral_origins WHERE issue_id=? AND EXISTS(SELECT 1 FROM intake_decisions WHERE id=?)`).bind(issue.id,decisionId),
      ...(request.kind === 'deferred' ? [binding.prepare(`INSERT INTO issue_deferral_origins(issue_id,decision_id) SELECT issue_id,id FROM intake_decisions WHERE id=?`).bind(decisionId)] : []),
      (() => { const { sql, params } = issueWrite.toSQL(); return binding.prepare(sql).bind(...params) })(),
    ])
  if (automaticCycle) {
    const originalUpdate = statements.pop()!
    statements.push(binding.prepare(`SELECT CASE WHEN ${automaticCycle.condition} THEN 1 ELSE json('automatic cycle changed') END`).bind(...automaticCycle.values),
      ...automaticCycleStatements(binding, issue.id, automaticCycle.cycleId, now, 'id=? AND version=?', [issue.id, request.expectedVersion]), originalUpdate)
  }
  const issueWriteIndex = statements.length - 1
  statements.push(...finalizeEvent(binding,event))
  const writes = await commitWithAssignee(binding, request.kind === 'accepted' ? (request.input as AcceptIssueInput).assigneeOperatorId : null, team.workspaceId, statements)
  // The browsing revision trigger writes too. Only the guarded issue's native
  // RETURNING row identifies whether this decision actually committed.
  const rows = writes[issueWriteIndex].results as { id: string }[]
  return rows.length === 1 && rows[0].id === issue.id
    ? { outcome: 'written', identifier: issue.identifier }
    : { outcome: 'stale', identifier: issue.identifier }
}

function decisionSelection(db: Database, identifier: string, request: IntakeDecisionRecordInput, next: DecisionState, now: string, decisionId: string) {
  return db.select({
    id: sql<string>`${decisionId}`.as('id'),
    issueId: issues.id,
    actorOperatorId: sql<string>`${request.actorOperatorId}`.as('actor_operator_id'),
    kind: sql<string>`${request.kind}`.as('kind'),
    reason: sql<string | null>`${next.reason}`.as('reason'),
    returnAt: sql<string | null>`${next.returnAt}`.as('return_at'),
    createdAt: sql<string>`${now}`.as('created_at'),
    updatedAt: sql<string>`${now}`.as('updated_at'),
  }).from(issues).where(and(eq(issues.identifier, identifier), eq(issues.version, request.expectedVersion)))
}

function activitySelection(db: Database, identifier: string, request: IntakeDecisionRecordInput, next: DecisionState, now: string, activityId: string) {
  const activity = activityRow({
    issueId: '',
    actorOperatorId: request.actorOperatorId,
    kind: `intake.${request.kind}`,
    previousValue: next.previousValue,
    nextValue: next.nextValue,
    now,
  })
  return db.select({
    id: sql<string>`${activityId}`.as('id'),
    issueId: issues.id,
    actorOperatorId: sql<string>`${activity.actorOperatorId}`.as('actor_operator_id'),
    actorName: sql<string | null>`${activity.actorName}`.as('actor_name'),
    agentId: sql<string | null>`${activity.agentId}`.as('agent_id'),
    agentOperationId: sql<string | null>`${activity.agentOperationId}`.as('agent_operation_id'),
    agentApproversJson: sql<string | null>`${activity.agentApproversJson}`.as('agent_approvers_json'),
    kind: sql<string>`${activity.kind}`.as('kind'),
    previousValueJson: sql<string | null>`${activity.previousValueJson}`.as('previous_value_json'),
    nextValueJson: sql<string | null>`${activity.nextValueJson}`.as('next_value_json'),
    createdAt: sql<string>`${now}`.as('created_at'),
    updatedAt: sql<string>`${now}`.as('updated_at'),
  }).from(issues).where(and(eq(issues.identifier, identifier), eq(issues.version, request.expectedVersion)))
}

async function nextDecisionState(
  db: Database,
  team: typeof teams.$inferSelect,
  issue: typeof issues.$inferSelect,
  request: IntakeDecisionRecordInput,
): Promise<DecisionState> {
  if (request.kind === 'accepted') {
    const input = request.input as AcceptIssueInput
    const status = input.statusId
      ? await requireStatus(db, input.statusId, team.id)
      : await defaultStatus(db, team.id, 'unstarted')
    if (!['started', 'unstarted'].includes(status.category)) {
      throw new IssueMutationError('invalid_option', 'Accepted intake must move to a Started or Unstarted status.')
    }
    await Promise.all([validateAssignee(db, input.assigneeOperatorId), validateCycle(db, input.cycleId, team.id)])
    return {
      issueValues: { statusId: status.id, assigneeOperatorId: input.assigneeOperatorId, priority: input.priority, cycleId: input.cycleId, deferredUntil: null, completedAt: null, canceledAt: null },
      reason: input.reason,
      returnAt: null,
      previousValue: decisionState(issue),
      nextValue: { statusId: status.id, assigneeOperatorId: input.assigneeOperatorId, priority: input.priority, cycleId: input.cycleId, deferredUntil: null },
    }
  }

  if (request.kind === 'deferred') {
    const input = request.input as DeferIssueInput
    if (new Date(input.returnAt) <= request.now) {
      throw new IssueMutationError('invalid_option', 'A deferral return time must be in the future.')
    }
    return {
      issueValues: { deferredUntil: input.returnAt },
      reason: input.reason,
      returnAt: input.returnAt,
      previousValue: { deferredUntil: issue.deferredUntil },
      nextValue: { deferredUntil: input.returnAt },
    }
  }

  const input = request.input as DeclineIssueInput
  const status = await defaultStatus(db, team.id, 'canceled')
  return {
    issueValues: { statusId: status.id, deferredUntil: null, canceledAt: request.now.toISOString(), completedAt: null },
    reason: input.reason,
    returnAt: null,
    previousValue: decisionState(issue),
    nextValue: { statusId: status.id, deferredUntil: null, canceledAt: request.now.toISOString() },
  }
}

function decisionState(issue: typeof issues.$inferSelect) {
  return {
    statusId: issue.statusId,
    assigneeOperatorId: issue.assigneeOperatorId,
    priority: issue.priority,
    cycleId: issue.cycleId,
    deferredUntil: issue.deferredUntil,
  }
}

export async function requireActiveTeam(db: Database, teamId: string) {
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1)
  if (!team) throw new IssueMutationError('invalid_option', `Team ${teamId} does not exist.`)
  if (team.archivedAt !== null) throw new IssueMutationError('invalid_option', `Team ${team.name} is archived.`)
  return team
}

export async function requireIssue(db: Database, identifier: string) {
  const [issue] = await db.select().from(issues).where(eq(issues.identifier, identifier)).limit(1)
  if (!issue) throw new IssueMutationError('issue_not_found', `Issue ${identifier} does not exist.`)
  return issue
}

export async function requireStatus(db: Database, statusId: string, teamId: string) {
  const [status] = await db.select().from(workflowStatuses).where(and(eq(workflowStatuses.id, statusId), eq(workflowStatuses.teamId, teamId))).limit(1)
  if (!status) throw new IssueMutationError('invalid_option', `Workflow status ${statusId} does not belong to this team.`)
  return status
}

export async function defaultStatus(db: Database, teamId: string, category: string) {
  const [status] = await db.select().from(workflowStatuses).where(and(eq(workflowStatuses.teamId, teamId), eq(workflowStatuses.category, category))).orderBy(asc(workflowStatuses.position)).limit(1)
  if (!status) throw new Error(`Team ${teamId} has no ${category} workflow status.`)
  return status
}

async function validateIssueOptions(db: Database, workspaceId: string, teamId: string, input: CreateIssueInput) {
  await Promise.all([
    validateAssignee(db, input.assigneeOperatorId),
    validateProject(db, input.projectId, workspaceId),
    validateMilestone(db, input.milestoneId, input.projectId, workspaceId),
    validateCycle(db, input.cycleId, teamId),
    validateLabels(db, input.labelIds, workspaceId),
  ])
}

export async function validateAssignee(db: Database, operatorId: string | null) {
  if (operatorId === null) return
  const [operator] = await db.select().from(operators).where(eq(operators.id, operatorId)).limit(1)
  if (!operator || operator.removedAt !== null) throw new IssueMutationError('invalid_option', `Assignee ${operatorId} is unavailable.`)
}

export async function validateProject(db: Database, projectId: string | null, workspaceId: string) {
  if (projectId === null) return
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1)
  if (!project || project.workspaceId !== workspaceId || project.archivedAt !== null) {
    throw new IssueMutationError('invalid_option', `Project ${projectId} is unavailable.`)
  }
}

export async function validateMilestone(db: Database, milestoneId: string | null, projectId: string | null, workspaceId: string) {
  if (milestoneId === null) return
  const [milestone] = await db.select({ id: projectMilestones.id }).from(projectMilestones)
    .innerJoin(projects, eq(projects.id, projectMilestones.projectId))
    .where(and(eq(projectMilestones.id, milestoneId), eq(projects.workspaceId, workspaceId), projectId === null ? sql`0` : eq(projectMilestones.projectId, projectId))).limit(1)
  if (!milestone) throw new IssueMutationError('invalid_option', 'Milestone is unavailable for this project in this workspace.')
}

export async function validateCycle(db: Database, cycleId: string | null, teamId: string) {
  if (cycleId === null) return
  const [cycle] = await db.select().from(cycles).where(eq(cycles.id, cycleId)).limit(1)
  if (!cycle || cycle.teamId !== teamId || cycle.closedAt !== null) {
    throw new IssueMutationError('invalid_option', `Cycle ${cycleId} is unavailable for this team.`)
  }
}

export async function validateLabels(db: Database, labelIds: string[], workspaceId: string) {
  if (labelIds.length > seed.limits.labelsPerIssue || new Set(labelIds).size !== labelIds.length) throw new IssueMutationError('invalid_option', `Choose at most ${seed.limits.labelsPerIssue} distinct labels.`)
  if (labelIds.length === 0) return
  const found = await db.select({ id: labels.id, workspaceId: labels.workspaceId }).from(labels).where(inArray(labels.id, labelIds))
  if (found.length !== labelIds.length || found.some((label) => label.workspaceId !== workspaceId)) {
    throw new IssueMutationError('invalid_option', 'Every label must exist in this workspace.')
  }
}

export function activityRow(entry: {
  issueId: string
  actorOperatorId: string
  kind: string
  previousValue: unknown
  nextValue: unknown
  now: string
}) {
  return {
    id: createUlid(new Date(entry.now)),
    issueId: entry.issueId,
    actorOperatorId: entry.actorOperatorId,
    actorName: currentAgentActor()?.actor.label ?? null,
    ...agentActivity(),
    kind: entry.kind,
    previousValueJson: entry.previousValue === null ? null : JSON.stringify(entry.previousValue),
    nextValueJson: entry.nextValue === null ? null : JSON.stringify(entry.nextValue),
    createdAt: entry.now,
    updatedAt: entry.now,
  }
}
