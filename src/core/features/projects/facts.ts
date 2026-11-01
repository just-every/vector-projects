import type { WorkspaceSnapshot } from "../streams";

export function isTerminalCategory(category: string | undefined): boolean {
  return ["completed", "canceled", "duplicate"].includes(category ?? "");
}

export function isBlocked(
  snapshot: WorkspaceSnapshot,
  issueId: string,
  categories = categoryByStatus(snapshot),
): boolean {
  return snapshot.dependencies.some((dependency) => {
    if (dependency.blockedIssueId !== issueId) {
      return false;
    }
    const blockingIssue = snapshot.issues.find(
      (issue) => issue.id === dependency.blockingIssueId,
    );
    if (!blockingIssue) {
      throw new Error(
        `Dependency for issue ${issueId} references a missing issue`,
      );
    }
    return !["completed", "canceled", "duplicate"].includes(
      categories.get(blockingIssue.statusId) ?? "",
    );
  });
}

export function isActiveCycle(
  snapshot: WorkspaceSnapshot,
  cycleId: string,
  now: Date,
): boolean {
  const cycle = snapshot.cycles.find((item) => item.id === cycleId);
  return Boolean(
    cycle &&
    snapshot.teams.some(team => team.id === cycle.teamId && team.cyclesEnabled) &&
    cycle.closedAt === null &&
    cycle.startsAt <= now.toISOString() &&
    cycle.endsAt > now.toISOString(),
  );
}

export function categoryByStatus(
  snapshot: WorkspaceSnapshot,
): Map<string, string> {
  return new Map(
    snapshot.statuses.map((status) => [status.id, status.category]),
  );
}

export function dateInTimezone(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (kind: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === kind)?.value;
  const year = value("year");
  const month = value("month");
  const day = value("day");
  if (!year || !month || !day) {
    throw new Error(
      `Could not evaluate date in workspace timezone ${timezone}`,
    );
  }
  return `${year}-${month}-${day}`;
}
