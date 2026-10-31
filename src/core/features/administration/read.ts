import { visibleDirectoryPerson, visibleTeam, requestableTeam } from '../roles/visibility-sql';
import { readCycleSnapshot, readCycleFailure } from "../cycle-closure/read";
import seed from "../../../../seed.json";
import { settingsActor } from "../settings/repository";
import {
  administrationSchema,
  cycleDetailSchema,
  labelTextColor,
} from "./schema";
import { calculateCycleProgress } from "../cycles/progress";
import { readCycleReport } from "../cycle-report/read";
import { SettingsError } from "./transaction";

const cycleColumns =
  "c.id,c.team_id AS teamId,c.name,c.starts_at AS startsAt,c.ends_at AS endsAt,c.capacity,c.closed_at AS closedAt";
export async function readAdministration(db: D1Database, actor: string) {
  const { workspace_id: workspaceId, role } = await settingsActor(db, actor);
  const [workspace, teams, statuses, labels, projects, operators, cycles, projectLabels, schedules, housekeeping, members, departed, joinRequests] =
    await Promise.all([
      db
        .prepare("SELECT id,name,timezone,member_label_creation AS memberLabelCreation,member_team_creation AS memberTeamCreation FROM workspace_settings WHERE id=?")
        .bind(workspaceId)
        .first(),
      db
        .prepare(
          `SELECT t.id,t.name,CASE WHEN ${visibleTeam('reader','t.id')} THEN t.identifier_prefix ELSE '' END AS identifierPrefix,t.is_private AS isPrivate,${visibleTeam('reader','t.id')} AS canRead,
      CASE WHEN reader.role IN('owner','admin') OR ${visibleTeam('reader','t.id')} THEN (SELECT count(*) FROM main.issues i WHERE i.team_id=t.id) ELSE NULL END AS issueCount,t.archived_at AS archivedAt,t.cycles_enabled AS cyclesEnabled,t.auto_cycle_started AS autoCycleStarted,t.auto_cycle_completed AS autoCycleCompleted,
      CASE WHEN t.is_private=1 THEN 'invite_only' ELSE t.membership_mode END AS membershipMode,t.requests_enabled AS requestsEnabled,t.settings_permission AS settingsPermission,t.planning_permission AS planningPermission,
      NOT EXISTS(SELECT 1 FROM team_issue_history h WHERE h.team_id=t.id) AS prefixEditable
      FROM main.teams t JOIN operators reader ON reader.id='${actor.replaceAll("'","''")}' WHERE t.workspace_id=? AND (reader.role='admin' OR ${visibleTeam('reader','t.id')} OR ${requestableTeam('reader','t.id')}) ORDER BY t.name,t.id`,
        )
        .bind(workspaceId)
        .all(),
      db
        .prepare(
          "SELECT s.id,s.team_id AS teamId,s.name,s.category,s.position FROM workflow_statuses s JOIN teams t ON t.id=s.team_id WHERE t.workspace_id=? ORDER BY s.position,s.id",
        )
        .bind(workspaceId)
        .all(),
      db
        .prepare(
          "SELECT id,name,color,projects_enabled AS projectsEnabled FROM labels WHERE workspace_id=? ORDER BY name,id",
        )
        .bind(workspaceId)
        .all<{ id: string; name: string; color: string; projectsEnabled: number }>(),
      db
        .prepare(
          "SELECT id,name,description,lead_operator_id AS leadOperatorId,start_date AS startDate,target_date AS targetDate,color,icon,priority,lifecycle,archived_at AS archivedAt FROM projects WHERE workspace_id=? ORDER BY name,id",
        )
        .bind(workspaceId)
        .all(),
      db
        .prepare(
          `SELECT person.id,person.name,person.role FROM operators person WHERE person.workspace_id=? AND person.removed_at IS NULL AND ${visibleDirectoryPerson('person','?')} ORDER BY name,id`,
        )
        .bind(workspaceId,actor)
        .all(),
      db
        .prepare(
          `SELECT ${cycleColumns} FROM cycles c JOIN teams t ON t.id=c.team_id WHERE t.workspace_id=? ORDER BY c.starts_at,c.id`,
        )
        .bind(workspaceId)
        .all(),
      db.prepare("SELECT pl.project_id AS projectId,pl.label_id AS labelId FROM project_labels pl JOIN projects p ON p.id=pl.project_id WHERE p.workspace_id=? ORDER BY pl.label_id").bind(workspaceId).all<{projectId:string;labelId:string}>(),
      db.prepare("SELECT s.team_id AS teamId,s.weeks,s.start_weekday AS startWeekday,s.cooldown_weeks AS cooldownWeeks,s.upcoming_count AS upcomingCount FROM team_cycle_schedules s JOIN teams t ON t.id=s.team_id WHERE t.workspace_id=?").bind(workspaceId).all(),
      db.prepare("SELECT h.team_id AS teamId,h.close_after_days AS closeAfterDays,h.archive_after_days AS archiveAfterDays,h.exempt_bugs AS exemptBugs FROM team_housekeeping h JOIN teams t ON t.id=h.team_id WHERE t.workspace_id=?").bind(workspaceId).all<{teamId:string;closeAfterDays:number|null;archiveAfterDays:number|null;exemptBugs:number}>(),
      db.prepare("SELECT m.team_id AS teamId,m.operator_id AS operatorId,m.role FROM main.team_members m JOIN main.teams t ON t.id=m.team_id JOIN operators o ON o.id=m.operator_id JOIN operators reader ON reader.id=? WHERE t.workspace_id=? AND o.removed_at IS NULL AND (reader.role IN('owner','admin') OR EXISTS(SELECT 1 FROM teams visible WHERE visible.id=t.id)) ORDER BY m.role DESC,o.name,o.id").bind(actor,workspaceId).all<{teamId:string;operatorId:string;role:string}>(),
      // ROLE-007: issues still assigned to someone who left the team, for its owners to reassign.
      db.prepare(`SELECT i.team_id AS teamId,i.identifier,i.title,i.assignee_operator_id AS assigneeOperatorId FROM issues i
        JOIN team_departures d ON d.team_id=i.team_id AND d.operator_id=i.assignee_operator_id
        JOIN workflow_statuses s ON s.id=i.status_id JOIN teams t ON t.id=i.team_id
        WHERE t.workspace_id=? AND s.category NOT IN ('completed','canceled','duplicate')
        AND NOT EXISTS(SELECT 1 FROM team_members m WHERE m.team_id=i.team_id AND m.operator_id=i.assignee_operator_id)
        ORDER BY i.identifier`).bind(workspaceId).all<{teamId:string;identifier:string;title:string;assigneeOperatorId:string}>(),
      db.prepare(`SELECT r.team_id AS teamId,r.requester_id AS requesterId,o.name,r.state FROM team_join_requests r
        JOIN main.teams t ON t.id=r.team_id JOIN operators o ON o.id=r.requester_id AND o.removed_at IS NULL
        WHERE t.workspace_id=? AND (r.requester_id=? OR EXISTS(SELECT 1 FROM operators actor WHERE actor.id=? AND actor.role IN('owner','admin'))
          OR EXISTS(SELECT 1 FROM team_members own WHERE own.team_id=t.id AND own.operator_id=? AND own.role='owner')) ORDER BY r.created_at,r.requester_id`)
        .bind(workspaceId,actor,actor,actor).all<{teamId:string;requesterId:string;name:string;state:string}>(),
    ]);
  if ((await settingsActor(db, actor)).workspace_id !== workspaceId)
    throw new SettingsError(
      "unauthenticated",
      "Workspace changed. Sign in again.",
      401,
    );
  return administrationSchema.parse({
    viewer: { id: actor, role },
    workspace: workspace && {...workspace, memberLabelCreation: workspace.memberLabelCreation === 1, memberTeamCreation: workspace.memberTeamCreation === 1},
    cycleSchedules: schedules.results,
    housekeeping: housekeeping.results.map((h) => ({ ...h, exemptBugs: h.exemptBugs === 1 })),
    labelsPerIssue: seed.limits.labelsPerIssue,
    teams: teams.results.map((t) => ({
      ...t,
      prefixEditable: Boolean(t.prefixEditable),
      isPrivate: Boolean(t.isPrivate),
      canRead: Boolean(t.canRead),
      requestsEnabled: Boolean(t.requestsEnabled),
      joinRequests: joinRequests.results.filter(request=>request.teamId===t.id),
      cyclesEnabled: Boolean(t.cyclesEnabled),
      autoCycleStarted: Boolean(t.autoCycleStarted),
      autoCycleCompleted: Boolean(t.autoCycleCompleted),
      statuses: statuses.results.filter((s) => s.teamId === t.id),
      members: members.results.filter((m) => m.teamId === t.id).map(({ operatorId, role }) => ({ operatorId, role })),
      departedAssignments: departed.results.filter((d) => d.teamId === t.id).map(({ teamId: _team, ...issue }) => issue),
    })),
    labels: labels.results.map((l) => ({
      ...l,
      textColor: labelTextColor(l.color),
      projectsEnabled: Boolean(l.projectsEnabled),
    })),
    projects: projects.results.map(p => ({...p, labelIds: projectLabels.results.filter(l => l.projectId === p.id).map(l => l.labelId)})),
    operators: operators.results,
    cycles: cycles.results,
  });
}
export async function readCycle(db: D1Database, actor: string, id: string) {
  const access = await settingsActor(db, actor);
  const cycle = await db
    .prepare(
      `SELECT ${cycleColumns},w.timezone FROM cycles c JOIN teams t ON t.id=c.team_id JOIN workspace_settings w ON w.id=t.workspace_id WHERE c.id=? AND t.workspace_id=?`,
    )
    .bind(id, access.workspace_id)
    .first<{
      id: string;
      teamId: string;
      name: string;
      startsAt: string;
      endsAt: string;
      capacity: number | null;
      closedAt: string | null;
      timezone: string;
    }>();
  if (!cycle)
    throw new SettingsError("not_found", "Cycle is unavailable.", 404);
  const issues = (
    await db
      .prepare(
        `SELECT i.id,i.identifier,i.title,i.version,i.team_id AS teamId,i.status_id AS statusId,s.category,i.estimate,i.cycle_id AS cycleId FROM issues i JOIN workflow_statuses s ON s.id=i.status_id WHERE i.cycle_id=? AND i.team_id=? ORDER BY i.identifier`,
      )
      .bind(id, cycle.teamId)
      .all<{ identifier: string; category: string; estimate: number | null }>()
  ).results;
  const [snapshot, failure] = await Promise.all([
    readCycleSnapshot(db, id),
    readCycleFailure(db, id),
  ]);
  const report = await readCycleReport(db, cycle, issues, snapshot);
  if ((await settingsActor(db, actor)).workspace_id !== access.workspace_id)
    throw new SettingsError(
      "unauthenticated",
      "Workspace changed. Sign in again.",
      401,
    );
  return cycleDetailSchema.parse({
    cycle: snapshot ? { ...cycle, closedAt: snapshot.closedAt } : cycle,
    workspaceTimezone: snapshot?.timezone ?? cycle.timezone,
    snapshot,
    report,
    failure,
    issues,
    progress:
      snapshot?.progress ?? calculateCycleProgress(issues, cycle.capacity),
  });
}
