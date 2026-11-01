import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

const timestamps = {
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}

export const workspaceSettings = sqliteTable('workspace_settings', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull(),
  ...timestamps,
})

export const operators = sqliteTable('operators', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  removedAt: text('removed_at'),
  role: text('role', { enum: ['owner', 'admin', 'member', 'guest', 'viewer'] }).notNull().default('owner'),
  ...timestamps,
}, (table) => [uniqueIndex('operators_email_idx').on(table.email)])

export const operatorSessions = sqliteTable('operator_sessions', {
  id: text('id').primaryKey(),
  operatorId: text('operator_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: text('expires_at').notNull(),
  revokedAt: text('revoked_at'),
  ...timestamps,
}, (table) => [uniqueIndex('operator_sessions_token_idx').on(table.tokenHash)])

export const teams = sqliteTable('teams', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  name: text('name').notNull(),
  identifierPrefix: text('identifier_prefix').notNull(),
  isPrivate: integer('is_private', { mode: 'boolean' }).notNull().default(false),
  archivedAt: text('archived_at'),
  cyclesEnabled: integer('cycles_enabled', { mode: 'boolean' }).notNull().default(true),
  ...timestamps,
}, (table) => [
  uniqueIndex('teams_workspace_name_idx').on(table.workspaceId, table.name),
  uniqueIndex('teams_workspace_prefix_idx').on(table.workspaceId, table.identifierPrefix),
])

export const workflowStatuses = sqliteTable('workflow_statuses', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  position: integer('position').notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex('workflow_statuses_team_name_idx').on(table.teamId, table.name),
  uniqueIndex('workflow_statuses_team_position_idx').on(table.teamId, table.position),
])

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  leadOperatorId: text('lead_operator_id').notNull(),
  startDate: text('start_date'),
  targetDate: text('target_date'),
  priority: text('priority').notNull().default('none'),
  lifecycle: text('lifecycle').notNull(),
  color: text('color'),
  icon: text('icon'),
  archivedAt: text('archived_at'),
  ...timestamps,
}, (table) => [uniqueIndex('projects_workspace_name_idx').on(table.workspaceId, table.name)])

export const projectMilestones = sqliteTable('project_milestones', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull(),
  targetDate: text('target_date'),
  position: integer('position').notNull(),
  completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
  ...timestamps,
}, (table) => [uniqueIndex('project_milestones_position_idx').on(table.projectId, table.position)])

export const cycles = sqliteTable('cycles', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull(),
  name: text('name').notNull(),
  startsAt: text('starts_at').notNull(),
  endsAt: text('ends_at').notNull(),
  capacity: integer('capacity'),
  closedAt: text('closed_at'),
  ...timestamps,
}, (table) => [uniqueIndex('cycles_team_name_idx').on(table.teamId, table.name)])

export const projectLabels = sqliteTable('project_labels', {
  projectId: text('project_id').notNull(),
  labelId: text('label_id').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [primaryKey({ columns: [table.projectId, table.labelId] })])

export const labels = sqliteTable('labels', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  name: text('name').notNull(),
  color: text('color').notNull(),
  projectsEnabled: integer('projects_enabled', { mode: 'boolean' }).notNull().default(false),
  ...timestamps,
}, (table) => [uniqueIndex('labels_workspace_name_idx').on(table.workspaceId, table.name)])

export const issues = sqliteTable('issues', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  originPrefix: text('origin_prefix').notNull(),
  sequenceNumber: integer('sequence_number').notNull(),
  teamId: text('team_id').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  statusId: text('status_id').notNull(),
  priority: text('priority').notNull(),
  assigneeOperatorId: text('assignee_operator_id'),
  projectId: text('project_id'),
  milestoneId: text('milestone_id').references(() => projectMilestones.id, { onDelete: 'set null' }),
  cycleId: text('cycle_id'),
  startDate: text('start_date'),
  dueDate: text('due_date'),
  estimate: integer('estimate'),
  expectedOutcome: text('expected_outcome'),
  customerImpact: text('customer_impact'),
  customFieldsJson: text('custom_fields_json').notNull(),
  deferredUntil: text('deferred_until'),
  version: integer('version').notNull(),
  completedAt: text('completed_at'),
  canceledAt: text('canceled_at'),
  archivedAt: text('archived_at'),
  ...timestamps,
}, (table) => [
  uniqueIndex('issues_identifier_idx').on(table.identifier),
  index('issues_team_status_idx').on(table.teamId, table.statusId),
  index('issues_assignee_idx').on(table.assigneeOperatorId),
  index('issues_project_idx').on(table.projectId),
  index('issues_milestone_idx').on(table.milestoneId),
  index('issues_cycle_idx').on(table.cycleId),
])

export const teamIssueSequences = sqliteTable('team_issue_sequences', {
  teamId: text('team_id').primaryKey(),
  lastSequence: integer('last_sequence').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const issueLabels = sqliteTable('issue_labels', {
  issueId: text('issue_id').notNull(),
  labelId: text('label_id').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [primaryKey({ columns: [table.issueId, table.labelId] })])

export const issueDependencies = sqliteTable('issue_dependencies', {
  blockedIssueId: text('blocked_issue_id').notNull(),
  blockingIssueId: text('blocking_issue_id').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [primaryKey({ columns: [table.blockedIssueId, table.blockingIssueId] })])

export const evidenceRevisions = sqliteTable('evidence_revisions', {
  id: text('id').primaryKey(),
  issueId: text('issue_id').notNull(),
  sourceName: text('source_name').notNull(),
  observedAt: text('observed_at').notNull(),
  receivedAt: text('received_at').notNull(),
  summary: text('summary').notNull(),
  measurementsJson: text('measurements_json').notNull(),
  assertionsJson: text('assertions_json').notNull(),
  ...timestamps,
}, (table) => [index('evidence_revisions_issue_idx').on(table.issueId, table.observedAt, table.receivedAt)])

export const intakeDecisions = sqliteTable('intake_decisions', {
  id: text('id').primaryKey(),
  issueId: text('issue_id').notNull(),
  actorOperatorId: text('actor_operator_id').notNull(),
  kind: text('kind').notNull(),
  reason: text('reason'),
  returnAt: text('return_at'),
  ...timestamps,
})

export const issueActivity = sqliteTable('issue_activity', {
  id: text('id').primaryKey(),
  issueId: text('issue_id').notNull(),
  actorOperatorId: text('actor_operator_id'),
  actorName: text('actor_name'),
  agentId: text('agent_id'),
  agentOperationId: text('agent_operation_id'),
  agentApproversJson: text('agent_approvers_json'),
  kind: text('kind').notNull(),
  previousValueJson: text('previous_value_json'),
  nextValueJson: text('next_value_json'),
  ...timestamps,
}, (table) => [index('issue_activity_issue_idx').on(table.issueId, table.createdAt)])

export const savedViews = sqliteTable('saved_views', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  ownerOperatorId: text('owner_operator_id').notNull(),
  name: text('name').notNull(),
  surface: text('surface').notNull(),
  isShared: integer('is_shared', { mode: 'boolean' }).notNull(),
  filtersJson: text('filters_json').notNull(),
  sort: text('sort').notNull(),
  grouping: text('grouping').notNull(),
  ...timestamps,
}, (table) => [uniqueIndex('saved_views_owner_name_idx').on(table.ownerOperatorId, table.name)])

export const listPreferences = sqliteTable('list_preferences', {
  id: text('id').primaryKey(),
  operatorId: text('operator_id').notNull(),
  surface: text('surface').notNull(),
  filtersJson: text('filters_json').notNull(),
  sort: text('sort').notNull(),
  grouping: text('grouping').notNull(),
  ...timestamps,
}, (table) => [uniqueIndex('list_preferences_operator_surface_idx').on(table.operatorId, table.surface)])
