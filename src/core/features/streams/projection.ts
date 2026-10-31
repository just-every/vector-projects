import {
  categoryByStatus,
  dateInTimezone,
  isActiveCycle,
  isBlocked,
  projectHealthForIssue,
} from "../projects";
import type { WorkspaceSnapshot } from "./snapshot";
import { calculateCycleProgress, type CycleProgress } from "../cycles/progress";

export type CurrentSection =
  "needs-decision" | "now" | "next" | "recently-done";
export type WorkSection = "waiting" | "now" | "next";
export type PrimaryReason =
  | "awaiting-decision"
  | "overdue"
  | "started-work"
  | "due-within-seven-days"
  | "cycle-commitment"
  | "completed-within-seven-days"
  | "assigned-to-you"
  | "unresolved-dependency";
export type ContextReason =
  | "customer-escalation"
  | "unresolved-dependency"
  | "unassigned-urgent-work"
  | "project-risk"
  | "new-evidence";

export type StreamItem = {
  id: string;
  identifier: string;
  title: string;
  version: number;
  estimate: number | null;
  cycle: { id: string; name: string } | null;
  labels: Array<{ id: string; name: string; color: string }>;
  status: { id: string; name: string; category: string };
  priority: string;
  startDate: string | null;
  dueDate: string | null;
  updatedAt: string;
  assignee: { id: string; name: string } | null;
  project: { id: string; name: string; health: string } | null;
  milestoneId: string | null;
  milestone: { id: string; name: string; projectId: string } | null;
  team: { id: string; name: string; identifierPrefix: string };
  primaryReason: PrimaryReason;
  contextReasons: ContextReason[];
};

export type CurrentProjection = {
  generatedAt: string;
  sections: Record<CurrentSection, StreamItem[]>;
};

export type MyWorkProjection = {
  generatedAt: string;
  operator: { id: string; name: string };
  sections: Record<WorkSection, StreamItem[]>;
  cycles: Array<
    CycleProgress & {
      id: string;
      name: string;
      team: string;
      startsAt: string;
      endsAt: string;
      timezone: string;
    }
  >;
};

export function projectCurrent(
  snapshot: WorkspaceSnapshot,
  now: Date,
): CurrentProjection {
  const sections: Record<CurrentSection, StreamItem[]> = {
    "needs-decision": [],
    now: [],
    next: [],
    "recently-done": [],
  };
  for (const issue of snapshot.issues) {
    const classification = classifyCurrentIssue(snapshot, issue, now);
    if (!classification) {
      continue;
    }
    sections[classification.section].push(
      toStreamItem(snapshot, issue, classification.reason, now),
    );
  }
  sections["needs-decision"] = rankIssues(
    sections["needs-decision"],
    now,
    snapshot.workspace?.timezone ?? "UTC",
  );
  sections.now = rankIssues(
    sections.now,
    now,
    snapshot.workspace?.timezone ?? "UTC",
  );
  sections.next = rankIssues(
    sections.next,
    now,
    snapshot.workspace?.timezone ?? "UTC",
  );
  const completionTimes = new Map(
    snapshot.issues.map((issue) => [issue.id, issue.completedAt]),
  );
  sections["recently-done"].sort((left, right) => {
    const rightCompletedAt = completionTimes.get(right.id);
    const leftCompletedAt = completionTimes.get(left.id);
    if (!leftCompletedAt || !rightCompletedAt)
      throw new Error("Recently completed issues must carry completion times");
    return (
      rightCompletedAt.localeCompare(leftCompletedAt) ||
      left.identifier.localeCompare(right.identifier)
    );
  });
  return { generatedAt: now.toISOString(), sections };
}

export function projectMyWork(
  snapshot: WorkspaceSnapshot,
  operatorId: string,
  now: Date,
): MyWorkProjection {
  const operator = snapshot.operators.find(
    (item) => item.id === operatorId && item.removedAt === null,
  );
  if (!operator) {
    throw new Error(`Operator ${operatorId} is unavailable`);
  }
  const sections: Record<WorkSection, StreamItem[]> = {
    waiting: [],
    now: [],
    next: [],
  };
  const categories = categoryByStatus(snapshot);
  for (const issue of snapshot.issues) {
    const category = categories.get(issue.statusId);
    if (
      issue.assigneeOperatorId !== operatorId ||
      (issue.deferredUntil && new Date(issue.deferredUntil) > now) ||
      ["intake", "completed", "canceled", "duplicate"].includes(category ?? "")
    ) {
      continue;
    }
    if (isBlocked(snapshot, issue.id, categories)) {
      sections.waiting.push(
        toStreamItem(snapshot, issue, "unresolved-dependency", now),
      );
      continue;
    }
    const current = classifyCurrentIssue(snapshot, issue, now);
    if (current?.section === "now") {
      sections.now.push(toStreamItem(snapshot, issue, current.reason, now));
      continue;
    }
    sections.next.push(
      toStreamItem(snapshot, issue, current?.reason ?? "assigned-to-you", now),
    );
  }
  const timezone = snapshot.workspace?.timezone ?? "UTC";
  sections.waiting = rankIssues(sections.waiting, now, timezone);
  sections.now = rankIssues(sections.now, now, timezone);
  sections.next = rankIssues(sections.next, now, timezone);
  return {
    generatedAt: now.toISOString(),
    operator: { id: operator.id, name: operator.name },
    sections,
    cycles: activeCycleContext(snapshot, operatorId, now, categories),
  };
}

export function classifyCurrentIssue(
  snapshot: WorkspaceSnapshot,
  issue: WorkspaceSnapshot["issues"][number],
  now: Date,
): { section: CurrentSection; reason: PrimaryReason } | null {
  const category = categoryByStatus(snapshot).get(issue.statusId);
  if (!category) {
    throw new Error(`Issue ${issue.identifier} references an unknown status`);
  }
  if (
    ["canceled", "duplicate"].includes(category) ||
    (issue.deferredUntil && new Date(issue.deferredUntil) > now)
  ) {
    return null;
  }
  if (category === "intake") {
    const latestDecision = latestIntakeDecision(snapshot, issue.id);
    if (
      latestDecision?.kind === "accepted" ||
      latestDecision?.kind === "declined"
    ) {
      return null;
    }
    return { section: "needs-decision", reason: "awaiting-decision" };
  }
  const timezone = snapshot.workspace?.timezone ?? "UTC";
  const today = dateInTimezone(now, timezone);
  if (category === "completed") {
    // Include the whole workspace date seven days ago through the read instant.
    // Subtracting elapsed hours would shift the cutoff at midnight and at DST.
    return issue.completedAt &&
      new Date(issue.completedAt) <= now &&
      dateInTimezone(new Date(issue.completedAt), timezone) >= addDays(today, -7)
      ? { section: "recently-done", reason: "completed-within-seven-days" }
      : null;
  }
  const overdue = issue.dueDate !== null && issue.dueDate < today;
  if (overdue || category === "started") {
    return { section: "now", reason: overdue ? "overdue" : "started-work" };
  }
  if (category !== "unstarted") {
    return null;
  }
  const dueSoon =
    issue.dueDate !== null &&
    issue.dueDate >= today &&
    issue.dueDate <= addDays(today, 7);
  const cycleCommitted =
    snapshot.teams.some(team => team.id === issue.teamId && team.cyclesEnabled) &&
    issue.cycleId !== null && isActiveOrNextCycle(snapshot, issue.cycleId, now);
  if (dueSoon || cycleCommitted) {
    return {
      section: "next",
      reason: dueSoon ? "due-within-seven-days" : "cycle-commitment",
    };
  }
  return null;
}

export function rankIssues(
  items: StreamItem[],
  now: Date,
  timezone: string,
): StreamItem[] {
  const today = dateInTimezone(now, timezone);
  return [...items].sort((left, right) => {
    const priority = priorityRank(left.priority) - priorityRank(right.priority);
    if (priority !== 0) return priority;
    const due = compareDueDates(left.dueDate, right.dueDate, today);
    if (due !== 0) return due;
    const updated = right.updatedAt.localeCompare(left.updatedAt);
    if (updated !== 0) return updated;
    return left.identifier.localeCompare(right.identifier);
  });
}

function toStreamItem(
  snapshot: WorkspaceSnapshot,
  issue: WorkspaceSnapshot["issues"][number],
  primaryReason: PrimaryReason,
  now: Date,
): StreamItem {
  const status = snapshot.statuses.find((item) => item.id === issue.statusId);
  const team = snapshot.teams.find((item) => item.id === issue.teamId);
  if (!status || !team) {
    throw new Error(`Issue ${issue.identifier} has incomplete workflow data`);
  }
  const assignee =
    issue.assigneeOperatorId === null
      ? null
      : (snapshot.operators.find(
          (item) => item.id === issue.assigneeOperatorId,
        ) ?? null);
  const project =
    issue.projectId === null
      ? null
      : (snapshot.projects.find((item) => item.id === issue.projectId) ?? null);
  if (issue.assigneeOperatorId !== null && !assignee) {
    throw new Error(`Issue ${issue.identifier} references a missing assignee`);
  }
  if (issue.projectId !== null && !project) {
    throw new Error(`Issue ${issue.identifier} references a missing project`);
  }
  const milestone = issue.milestoneId === null ? null : snapshot.projectMilestones.find(item => item.id === issue.milestoneId);
  if (issue.milestoneId !== null && (!milestone || milestone.projectId !== issue.projectId))
    throw new Error(`Issue ${issue.identifier} references a missing or incompatible milestone`);
  return {
    id: issue.id,
    milestoneId: issue.milestoneId,
    milestone: milestone ? { id: milestone.id, name: milestone.name, projectId: milestone.projectId } : null,
    identifier: issue.identifier,
    title: issue.title,
    version: issue.version,
    estimate: issue.estimate,
    cycle: !team.cyclesEnabled || issue.cycleId === null ? null : (() => {
      const cycle = snapshot.cycles.find(row => row.id === issue.cycleId);
      if (!cycle) throw new Error(`Issue ${issue.identifier} references a missing cycle`);
      return { id: cycle.id, name: cycle.name };
    })(),
    labels: snapshot.issueLabels.filter(row => row.issueId === issue.id).map(row => {
      const label = snapshot.labels.find(label => label.id === row.labelId);
      if (!label) throw new Error(`Issue ${issue.identifier} references a missing label`);
      return { id: label.id, name: label.name, color: label.color };
    }),
    status: { id: status.id, name: status.name, category: status.category },
    priority: issue.priority,
    startDate: issue.startDate,
    dueDate: issue.dueDate,
    updatedAt: issue.updatedAt,
    assignee: assignee && { id: assignee.id, name: assignee.name },
    project: project && {
      id: project.id,
      name: project.name,
      health: projectHealthForIssue(snapshot, project.id, now),
    },
    team: {
      id: team.id,
      name: team.name,
      identifierPrefix: team.identifierPrefix,
    },
    primaryReason,
    contextReasons: contextReasons(snapshot, issue, now).filter(
      (reason) => reason !== primaryReason,
    ),
  };
}

function contextReasons(
  snapshot: WorkspaceSnapshot,
  issue: WorkspaceSnapshot["issues"][number],
  now: Date,
): ContextReason[] {
  const labelIds = new Set(
    snapshot.issueLabels
      .filter((item) => item.issueId === issue.id)
      .map((item) => item.labelId),
  );
  const labels = snapshot.labels.filter((label) => labelIds.has(label.id));
  const reasons: ContextReason[] = [];
  if (labels.some((label) => label.name === "Customer escalation"))
    reasons.push("customer-escalation");
  if (isBlocked(snapshot, issue.id)) reasons.push("unresolved-dependency");
  if (issue.priority === "urgent" && issue.assigneeOperatorId === null)
    reasons.push("unassigned-urgent-work");
  if (
    projectHealthForIssue(snapshot, issue.projectId, now) === "blocked" ||
    projectHealthForIssue(snapshot, issue.projectId, now) === "at-risk"
  )
    reasons.push("project-risk");
  const latestDecision = latestIntakeDecision(snapshot, issue.id);
  if (
    snapshot.evidence.some(
      (evidence) =>
        evidence.issueId === issue.id &&
        (!latestDecision || evidence.receivedAt > latestDecision.createdAt),
    )
  )
    reasons.push("new-evidence");
  return reasons;
}

function activeCycleContext(
  snapshot: WorkspaceSnapshot,
  operatorId: string,
  now: Date,
  categories: Map<string, string>,
) {
  return snapshot.cycles
    .filter((cycle) => isActiveCycle(snapshot, cycle.id, now))
    .flatMap((cycle) => {
      const committed = snapshot.issues.filter(
        (issue) => issue.cycleId === cycle.id,
      );
      if (!committed.some((issue) => issue.assigneeOperatorId === operatorId))
        return [];
      const team = snapshot.teams.find((item) => item.id === cycle.teamId);
      if (!team)
        throw new Error(`Cycle ${cycle.name} references a missing team`);
      return [
        {
          id: cycle.id,
          name: cycle.name,
          team: team.name,
          startsAt: cycle.startsAt,
          endsAt: cycle.endsAt,
          ...calculateCycleProgress(
            committed.map((issue) => {
              const category = categories.get(issue.statusId);
              if (!category)
                throw new Error(
                  `Issue ${issue.identifier} references an unknown status`,
                );
              return { category, estimate: issue.estimate };
            }),
            cycle.capacity,
          ),
          timezone: snapshot.workspace?.timezone ?? "UTC",
        },
      ];
    });
}

function latestIntakeDecision(snapshot: WorkspaceSnapshot, issueId: string) {
  return snapshot.decisions
    .filter((decision) => decision.issueId === issueId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

function isActiveOrNextCycle(
  snapshot: WorkspaceSnapshot,
  cycleId: string,
  now: Date,
): boolean {
  if (isActiveCycle(snapshot, cycleId, now)) return true;
  const cycle = snapshot.cycles.find((item) => item.id === cycleId);
  if (!cycle || cycle.startsAt < now.toISOString()) return false;
  const teamCycles = snapshot.cycles.filter(
    (item) => item.teamId === cycle.teamId && item.closedAt === null,
  );
  const active = teamCycles.find(
    (item) =>
      item.startsAt <= now.toISOString() && item.endsAt > now.toISOString(),
  );
  const threshold = active?.endsAt ?? now.toISOString();
  const next = teamCycles
    .filter((item) => item.startsAt >= threshold)
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt))[0];
  return next?.id === cycleId;
}

function priorityRank(priority: string): number {
  return ["urgent", "high", "medium", "low", "none"].indexOf(priority);
}

function compareDueDates(
  left: string | null,
  right: string | null,
  today: string,
): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  const leftOverdue = left < today;
  const rightOverdue = right < today;
  if (leftOverdue !== rightOverdue) return leftOverdue ? -1 : 1;
  return left.localeCompare(right);
}

function addDays(date: string, days: number): string {
  const midnight = new Date(`${date}T00:00:00.000Z`);
  midnight.setUTCDate(midnight.getUTCDate() + days);
  return midnight.toISOString().slice(0, 10);
}
