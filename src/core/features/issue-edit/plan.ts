import { issueReferenceStatements } from "../issue-references/repository";
import { planAutomaticCycle, automaticCycleStatements } from "../cycle-membership/plan";
import {
  assignmentStatements,
  mentionStatements,
  blockerStatements,
  followerChangeStatements,
  finalizeEvent,
} from "../notifications/events";
import { requireIssueAccess } from "../issues/access";
import seed from "../../../../seed.json";
import { drizzle } from "drizzle-orm/d1";
import {
  activityRow,
  requireIssue,
  requireStatus,
  validateAssignee,
  validateProject,
  validateMilestone,
  validateCycle,
  validateLabels,
} from "../issues/repository";
import { IssueMutationError } from "../issues/errors";
import type { UpdateIssueInput } from "./routes";

/** Only trusted feature services supply activity context; never request JSON. */
export type IssueUpdateMetadata =
  | { descriptionRestore: { revisionId: string } }
  | { checklist: { index: number; text: string; checked: boolean } };

const columns = {
  title: "title",
  description: "description",
  priority: "priority",
  assigneeOperatorId: "assignee_operator_id",
  statusId: "status_id",
  projectId: "project_id",
  milestoneId: "milestone_id",
  cycleId: "cycle_id",
  estimate: "estimate",
  startDate: "start_date",
  dueDate: "due_date",
  expectedOutcome: "expected_outcome",
  customerImpact: "customer_impact",
  completedAt: "completed_at",
  canceledAt: "canceled_at",
  archivedAt: "archived_at",
  customFields: "custom_fields_json",
} as const;

// JSON object order and label order do not constitute product changes.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map(
          (key) =>
            JSON.stringify(key) +
            ":" +
            canonical((value as Record<string, unknown>)[key]),
        )
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}

export async function planIssueUpdate(
  binding: D1Database,
  identifier: string,
  actor: string,
  input: UpdateIssueInput,
  forceRecord = false,
  metadata?: IssueUpdateMetadata,
) {
  await requireIssueAccess(binding, identifier, actor);
  if (
    input.labelIds &&
    (input.labelIds.length > seed.limits.labelsPerIssue ||
      new Set(input.labelIds).size !== input.labelIds.length)
  )
    throw new IssueMutationError(
      "invalid_option",
      "Too many or duplicate labels.",
    );
  // Keep the caller's native session fence and single-statement execution path.
  // The no-op UPDATE itself checks the version, active actor and workspace.
  const db = drizzle(binding),
    issue = await requireIssue(db, identifier),
    now = new Date().toISOString();
  if (issue.version !== input.expectedVersion) return null;
  const startDate = input.startDate === undefined ? issue.startDate : input.startDate;
  const dueDate = input.dueDate === undefined ? issue.dueDate : input.dueDate;
  if (startDate && dueDate && startDate > dueDate)
    throw new IssueMutationError("invalid_option", "Start date must be on or before due date.");
  const values: Record<string, unknown> = {},
    previous: Record<string, unknown> = {};
  for (const key of [
    "title",
    "description",
    "priority",
    "assigneeOperatorId",
    "statusId",
    "projectId",
    "milestoneId",
    "cycleId",
    "estimate",
    "startDate",
    "dueDate",
    "expectedOutcome",
    "customerImpact",
  ] as const) {
    if (input[key] !== undefined && input[key] !== issue[key]) {
      values[key] = input[key];
      previous[key] = issue[key];
    }
  }
  // Moving projects clears a retained milestone unless the caller chooses a
  // milestone for the destination explicitly. Both changes share one activity.
  if ("projectId" in values && input.milestoneId === undefined && issue.milestoneId !== null) {
    values.milestoneId = null;
    previous.milestoneId = issue.milestoneId;
  }
  if (input.customFields !== undefined) {
    const old = JSON.parse(issue.customFieldsJson);
    if (canonical(input.customFields) !== canonical(old)) {
      values.customFields = input.customFields;
      previous.customFields = old;
    }
  }
  const oldLabels = (
    await binding
      .prepare(
        "SELECT label_id FROM issue_labels WHERE issue_id=? ORDER BY label_id",
      )
      .bind(issue.id)
      .all<{ label_id: string }>()
  ).results.map((row) => row.label_id);
  const nextLabels = input.labelIds?.slice().sort();
  const labelsChanged =
    nextLabels !== undefined && canonical(nextLabels) !== canonical(oldLabels);
  if (labelsChanged) {
    previous.labelIds = oldLabels;
    values.labelIds = nextLabels;
  }

  // The same predicate guards every statement; the version changes last. An
  // option becoming unavailable after validation makes the entire batch a no-op.
  const conditions = [
      "issues.id=?",
      "issues.version=?",
      "EXISTS(SELECT 1 FROM operators WHERE id=? AND removed_at IS NULL)",
    ],
    guardValues: (string | number)[] = [issue.id, input.expectedVersion, actor];
  const guard = (condition: string, ...args: (string | number)[]) => {
    conditions.push(condition);
    guardValues.push(...args);
  };
  const team = await binding
    .prepare("SELECT workspace_id FROM teams WHERE id=?")
    .bind(issue.teamId)
    .first<{ workspace_id: string }>();
  if (!team) throw new Error("Issue team is missing.");
  guard(
    "EXISTS(SELECT 1 FROM operators WHERE id=? AND workspace_id=? AND removed_at IS NULL)",
    actor,
    team.workspace_id,
  );
  if ("assigneeOperatorId" in values && values.assigneeOperatorId !== null) {
    await validateAssignee(db, String(values.assigneeOperatorId));
    const operator = await binding
      .prepare("SELECT workspace_id FROM operators WHERE id=?")
      .bind(String(values.assigneeOperatorId))
      .first<{ workspace_id: string }>();
    if (operator?.workspace_id !== team.workspace_id)
      throw new IssueMutationError(
        "invalid_option",
        "Assignee is unavailable in this workspace.",
      );
    guard(
      "EXISTS(SELECT 1 FROM operators WHERE id=? AND workspace_id=? AND removed_at IS NULL)",
      String(values.assigneeOperatorId),
      team.workspace_id,
    );
  }
  if ("projectId" in values && values.projectId !== null) {
    await validateProject(db, String(values.projectId), team.workspace_id);
    guard(
      "EXISTS(SELECT 1 FROM projects WHERE id=? AND workspace_id=? AND archived_at IS NULL)",
      String(values.projectId),
      team.workspace_id,
    );
  }
  if (input.milestoneId !== undefined && input.milestoneId !== null) {
    const projectId = input.projectId === undefined ? issue.projectId : input.projectId;
    await validateMilestone(db, input.milestoneId, projectId, team.workspace_id);
    guard(
      "EXISTS(SELECT 1 FROM project_milestones m JOIN projects p ON p.id=m.project_id WHERE m.id=? AND m.project_id=? AND p.workspace_id=?)",
      input.milestoneId, projectId ?? "", team.workspace_id,
    );
  }
  if ("statusId" in values) {
    const current = await requireStatus(db, issue.statusId, issue.teamId),
      next = await requireStatus(db, String(values.statusId), issue.teamId);
    if (
      ["intake", "duplicate"].includes(current.category) ||
      !["backlog", "unstarted", "started", "completed", "canceled"].includes(
        next.category,
      )
    )
      throw new IssueMutationError(
        "invalid_transition",
        "Use an intake or duplicate decision for this transition.",
      );
    previous.completedAt = issue.completedAt;
    previous.canceledAt = issue.canceledAt;
    values.completedAt = next.category === "completed" ? now : null;
    values.canceledAt = next.category === "canceled" ? now : null;
    // A status change brings an archived issue back into lists (AUTO-003).
    if (issue.archivedAt) {
      previous.archivedAt = issue.archivedAt;
      values.archivedAt = null;
    }
    guard(
      "EXISTS(SELECT 1 FROM workflow_statuses WHERE id=? AND team_id=? AND category=?)",
      next.id,
      issue.teamId,
      next.category,
    );
    guard(
      "EXISTS(SELECT 1 FROM workflow_statuses WHERE id=issues.status_id AND category NOT IN ('intake','duplicate'))",
    );
  }
  if ("cycleId" in values) {
    const enabled = await binding.prepare("SELECT cycles_enabled FROM teams WHERE id=?").bind(issue.teamId).first<number>("cycles_enabled");
    if (enabled !== 1) throw new IssueMutationError("invalid_option", "Enable cycles in team Settings before changing commitments.");
    guard("EXISTS(SELECT 1 FROM teams WHERE id=? AND cycles_enabled=1)", issue.teamId);
  }
  if ("cycleId" in values && values.cycleId !== null) {
    await validateCycle(db, String(values.cycleId), issue.teamId);
    const status = await requireStatus(
      db,
      String(values.statusId ?? issue.statusId),
      issue.teamId,
    );
    if (["completed", "canceled", "duplicate"].includes(status.category))
      throw new IssueMutationError(
        "invalid_option",
        "Terminal work cannot be assigned to a cycle.",
      );
    guard(
      "EXISTS(SELECT 1 FROM cycles c JOIN teams t ON t.id=c.team_id WHERE c.id=? AND c.team_id=? AND t.cycles_enabled=1 AND c.closed_at IS NULL)",
      String(values.cycleId),
      issue.teamId,
    );
    guard(
      "EXISTS(SELECT 1 FROM workflow_statuses WHERE id=? AND team_id=? AND category NOT IN ('completed','canceled','duplicate'))",
      status.id,
      issue.teamId,
    );
  }
  if (labelsChanged) {
    // Retained historical selections need not pass today's workspace rules.
    const added = nextLabels.filter((id) => !oldLabels.includes(id));
    await validateLabels(db, added, team.workspace_id);
    for (const label of added)
      guard(
        "EXISTS(SELECT 1 FROM labels WHERE id=? AND workspace_id=?)",
        label,
        team.workspace_id,
      );
    for (const label of nextLabels)
      guard("EXISTS(SELECT 1 FROM labels WHERE id=?)", label);
  }
  const automaticCycle = values.statusId ? await planAutomaticCycle(binding, issue.teamId,
    (values.cycleId === undefined ? issue.cycleId : values.cycleId) as string | null,
    (await requireStatus(db, issue.statusId, issue.teamId)).category,
    (await requireStatus(db, String(values.statusId), issue.teamId)).category, now) : null;
  if (automaticCycle) guard(automaticCycle.condition, ...automaticCycle.values);
  const where = conditions.join(" AND ");
  if (Object.keys(values).length === 0 && !forceRecord) {
    return {
      where,
      guardValues,
      writes: [] as D1PreparedStatement[],
      mutationIndex: 0,
      identifier,
      version: issue.version,
      changed: false,
      activityId: null,
      undoFields: [] as string[],
    };
  }
  const recordBefore = { ...previous },
    recordAfter = { ...values };
  if (metadata && "descriptionRestore" in metadata) {
    recordBefore.description = issue.description;
    recordAfter.description = input.description;
  }
  if (forceRecord) {
    for (const key of [
      "statusId",
      "assigneeOperatorId",
      "priority",
      "projectId",
      "cycleId",
    ] as const) {
      if (input[key] !== undefined) {
        recordBefore[key] = issue[key];
        recordAfter[key] = input[key];
      }
    }
    if (input.labelIds !== undefined) {
      recordBefore.labelIds = oldLabels;
      recordAfter.labelIds = nextLabels;
    }
  }
  const activity = activityRow({
    issueId: issue.id,
    actorOperatorId: actor,
    kind: "issue.updated",
    previousValue: recordBefore,
    nextValue: { ...recordAfter, ...metadata },
    now,
  });
  const event = { id: activity.id, issueId: issue.id, actor, at: now };
  const writes = [
    binding
      .prepare(
        `INSERT INTO issue_activity(id,issue_id,actor_operator_id,kind,previous_value_json,next_value_json,created_at,updated_at,actor_name,agent_id,agent_operation_id,agent_approvers_json)
    SELECT ?,issues.id,?,'issue.updated',?,?,?,?,?,?,?,? FROM issues WHERE ${where}`,
      )
      .bind(
        activity.id,
        actor,
        activity.previousValueJson,
        activity.nextValueJson,
        now,
        now,
        activity.actorName,
        activity.agentId,
        activity.agentOperationId,
        activity.agentApproversJson,
        ...guardValues,
      ),
  ];
  writes.push(...blockerStatements(binding, event));
  writes.push(...followerChangeStatements(binding, event));
  if ("assigneeOperatorId" in values)
    writes.push(
      ...assignmentStatements(
        binding,
        event,
        values.assigneeOperatorId as string | null,
      ),
    );
  if ("description" in values)
    writes.push(
      ...mentionStatements(binding, event, values.description as string),
    );
  if (labelsChanged) {
    writes.push(
      binding
        .prepare(
          `DELETE FROM issue_labels WHERE issue_id=? AND EXISTS(SELECT 1 FROM issues WHERE ${where})`,
        )
        .bind(issue.id, ...guardValues),
    );
    for (const label of nextLabels)
      writes.push(
        binding
          .prepare(
            `INSERT INTO issue_labels(issue_id,label_id,created_at) SELECT issues.id,?,? FROM issues WHERE ${where}`,
          )
          .bind(label, now, ...guardValues),
      );
  }
  if (automaticCycle) {
    writes.push(...automaticCycleStatements(binding, issue.id, automaticCycle.cycleId, now, where, guardValues));
    values.cycleId = automaticCycle.cycleId;
  }
  const fields = Object.keys(values).filter(
    (key): key is keyof typeof columns => key in columns,
  );
  writes.push(
    binding
      .prepare(
        `UPDATE issues SET ${[...fields.map((key) => columns[key] + "=?"), `version=version+${automaticCycle ? 2 : 1}`, "updated_at=?"].join(",")} WHERE ${where} RETURNING id`,
      )
      .bind(
        ...fields.map((key) =>
          key === "customFields"
            ? JSON.stringify(values[key])
            : (values[key] as string | number | null),
        ),
        now,
        ...guardValues,
      ),
  );
  const mutationIndex = writes.length - 1;
  if ("description" in values) writes.push(...issueReferenceStatements(binding, event, values.description as string));
  writes.push(...finalizeEvent(binding, event));
  return {
    where,
    guardValues,
    writes,
    mutationIndex,
    identifier,
    activityId: activity.id,
    undoFields: [...Object.keys(recordBefore), ...(automaticCycle ? ["cycleId"] : [])],
    version: issue.version + (automaticCycle ? 2 : 1),
    changed: true,
  };
}
