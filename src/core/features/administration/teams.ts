import { z } from "zod";
import { createUlid } from "../../shared/ids";
import { statusRemovalNotifications } from "../notifications/status-removal";
import {
  teamCreateSchema,
  teamUpdateSchema,
  statusCreateSchema,
} from "./schema";
import {
  administrationContext,
  ownedRow,
  guard,
  commit,
  audit,
  SettingsError,
  type AdministrationContext,
} from "./transaction";

type Team = {
  id: string;
  name: string;
  identifier_prefix: string;
  archived_at: string | null;
  cycles_enabled: number;
  auto_cycle_started: number;
  auto_cycle_completed: number;
};
type Status = {
  id: string;
  team_id: string;
  name: string;
  category: string;
  position: number;
};
export async function createTeam(
  db: D1Database,
  actor: string,
  input: z.infer<typeof teamCreateSchema>,
  additional: (id:string)=>D1PreparedStatement[] = () => [],
) {
  const ctx = await administrationContext(db, actor),
    id = createUlid(new Date(ctx.at));
  const categories = [
    "intake",
    "backlog",
    "unstarted",
    "started",
    "completed",
    "canceled",
    "duplicate",
  ];
  await commit(ctx, [
    ctx.db
      .prepare(
        "INSERT INTO teams(id,workspace_id,name,identifier_prefix,created_at,updated_at,is_private) VALUES(?,?,?,?,?,?,?)",
      )
      .bind(
        id,
        ctx.workspace,
        input.name,
        input.identifierPrefix,
        ctx.at,
        ctx.at,
        Number(input.isPrivate ?? false),
      ),
    ...categories.map((category, position) =>
      ctx.db
        .prepare(
          "INSERT INTO workflow_statuses(id,team_id,name,category,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
        )
        .bind(
          createUlid(new Date(ctx.at)),
          id,
          category[0].toUpperCase() + category.slice(1),
          category,
          position,
          ctx.at,
          ctx.at,
        ),
    ),
    // ROLE-007: whoever creates a team is its first team owner.
    ctx.db
      .prepare("INSERT INTO team_members(team_id,operator_id,role,created_at,updated_at) VALUES(?,?,'owner',?,?)")
      .bind(id, actor, ctx.at, ctx.at),
    ...additional(id),
    ...audit(ctx, "team.created", id, input.name, null, input),
  ]);
  return id;
}
export async function updateTeam(
  db: D1Database,
  actor: string,
  id: string,
  input: z.infer<typeof teamUpdateSchema>,
) {
  const ctx = await administrationContext(db, actor),
    old = await ownedRow<Team>(ctx, "teams", id);
  const next = {
    cyclesEnabled: input.cyclesEnabled ?? Boolean(old.cycles_enabled),
    autoCycleStarted: input.autoCycleStarted ?? Boolean(old.auto_cycle_started),
    autoCycleCompleted: input.autoCycleCompleted ?? Boolean(old.auto_cycle_completed),
    name: input.name ?? old.name,
    identifierPrefix: input.identifierPrefix ?? old.identifier_prefix,
    archivedAt:
      input.archived === undefined
        ? old.archived_at
        : input.archived
          ? (old.archived_at ?? ctx.at)
          : null,
  };
  await commit(ctx, [
    guard(
      ctx.db,
      "EXISTS(SELECT 1 FROM teams WHERE id=? AND workspace_id=? AND name=? AND identifier_prefix=? AND archived_at IS ? AND auto_cycle_started=? AND auto_cycle_completed=? AND cycles_enabled=?)",
      id,
      ctx.workspace,
      old.name,
      old.identifier_prefix,
      old.archived_at,
      old.auto_cycle_started, old.auto_cycle_completed, old.cycles_enabled,
    ),
    ctx.db
      .prepare(
        "UPDATE teams SET name=?,identifier_prefix=?,archived_at=?,auto_cycle_started=?,auto_cycle_completed=?,cycles_enabled=?,updated_at=? WHERE id=?",
      )
      .bind(next.name, next.identifierPrefix, next.archivedAt, Number(next.autoCycleStarted), Number(next.autoCycleCompleted), Number(next.cyclesEnabled), ctx.at, id),
    ...audit(
      ctx,
      "team.updated",
      id,
      next.name,
      {
        name: old.name,
        identifierPrefix: old.identifier_prefix,
        archivedAt: old.archived_at,
        cyclesEnabled: Boolean(old.cycles_enabled),
        autoCycleStarted: Boolean(old.auto_cycle_started),
        autoCycleCompleted: Boolean(old.auto_cycle_completed),
      },
      next,
    ),
  ]);
}
async function workflow(ctx: AdministrationContext, teamId: string) {
  await ownedRow<Team>(ctx, "teams", teamId);
  return (
    await ctx.db
      .prepare(
        "SELECT * FROM workflow_statuses WHERE team_id=? ORDER BY position,id",
      )
      .bind(teamId)
      .all<Status>()
  ).results;
}
function workflowGuard(
  ctx: AdministrationContext,
  teamId: string,
  statuses: Status[],
) {
  return guard(
    ctx.db,
    `(SELECT json_group_array(json_array(id,name,category,position)) FROM (SELECT * FROM workflow_statuses WHERE team_id=? ORDER BY position,id))=?`,
    teamId,
    JSON.stringify(statuses.map((s) => [s.id, s.name, s.category, s.position])),
  );
}
export async function createStatus(
  db: D1Database,
  actor: string,
  teamId: string,
  input: z.infer<typeof statusCreateSchema>,
) {
  const ctx = await administrationContext(db, actor),
    statuses = await workflow(ctx, teamId),
    id = createUlid(new Date(ctx.at));
  await commit(ctx, [
    workflowGuard(ctx, teamId, statuses),
    ctx.db
      .prepare(
        "INSERT INTO workflow_statuses(id,team_id,name,category,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
      )
      .bind(
        id,
        teamId,
        input.name,
        input.category,
        Math.max(...statuses.map((s) => s.position)) + 1,
        ctx.at,
        ctx.at,
      ),
    ...audit(ctx, "workflow.status_created", id, input.name, null, {
      teamId,
      ...input,
    }),
  ]);
}
export async function renameStatus(
  db: D1Database,
  actor: string,
  teamId: string,
  id: string,
  name: string,
) {
  const ctx = await administrationContext(db, actor),
    statuses = await workflow(ctx, teamId),
    old = statuses.find((s) => s.id === id);
  if (!old) throw new SettingsError("not_found", "Status is unavailable.", 404);
  await commit(ctx, [
    workflowGuard(ctx, teamId, statuses),
    ctx.db
      .prepare("UPDATE workflow_statuses SET name=?,updated_at=? WHERE id=?")
      .bind(name, ctx.at, id),
    ...audit(
      ctx,
      "workflow.status_renamed",
      id,
      name,
      { name: old.name },
      { name },
    ),
  ]);
}
export async function reorderStatuses(
  db: D1Database,
  actor: string,
  teamId: string,
  ids: string[],
) {
  const ctx = await administrationContext(db, actor),
    statuses = await workflow(ctx, teamId);
  if (
    ids.length !== statuses.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !statuses.some((s) => s.id === id))
  )
    throw new SettingsError(
      "invalid_order",
      "Provide every status in this team exactly once.",
      400,
    );
  const offset =
    Math.max(...statuses.map((s) => s.position), statuses.length) + 1;
  await commit(ctx, [
    workflowGuard(ctx, teamId, statuses),
    ...ids.map((id, i) =>
      ctx.db
        .prepare("UPDATE workflow_statuses SET position=? WHERE id=?")
        .bind(offset + i, id),
    ),
    ...ids.map((id, i) =>
      ctx.db
        .prepare(
          "UPDATE workflow_statuses SET position=?,updated_at=? WHERE id=?",
        )
        .bind(i, ctx.at, id),
    ),
    ...audit(
      ctx,
      "workflow.reordered",
      teamId,
      teamId,
      statuses.map((s) => s.id),
      ids,
    ),
  ]);
}
export async function removeStatus(
  db: D1Database,
  actor: string,
  teamId: string,
  id: string,
  destination: string,
) {
  const ctx = await administrationContext(db, actor),
    statuses = await workflow(ctx, teamId),
    old = statuses.find((s) => s.id === id),
    target = statuses.find((s) => s.id === destination);
  if (!old) throw new SettingsError("not_found", "Status is unavailable.", 404);
  if (!target || target.id === old.id || target.category !== old.category)
    throw new SettingsError(
      "invalid_destination",
      "Choose a different status in the same category; the last status cannot be removed.",
      400,
    );
  const operationId = createUlid(new Date(ctx.at));
  const notifications = statusRemovalNotifications(ctx.db, operationId);
  await commit(ctx, [
    workflowGuard(ctx, teamId, statuses),
    ctx.db
      .prepare(
        `INSERT INTO issue_activity(id,issue_id,actor_operator_id,kind,previous_value_json,next_value_json,created_at,updated_at) SELECT ?||':'||id,id,?,'workflow.status_removed',json_object('statusId',status_id),json_object('statusId',?),?,? FROM issues WHERE team_id=? AND status_id=?`,
      )
      .bind(operationId, actor, destination, ctx.at, ctx.at, teamId, id),
    ...notifications.capture,
    ctx.db
      .prepare(
        "UPDATE issues SET status_id=?,version=version+1,updated_at=? WHERE team_id=? AND status_id=?",
      )
      .bind(destination, ctx.at, teamId, id),
    ctx.db.prepare("DELETE FROM workflow_statuses WHERE id=?").bind(id),
    ...notifications.finalize,
    ...audit(
      ctx,
      "workflow.status_removed",
      id,
      old.name,
      { teamId, statusId: id, category: old.category },
      { teamId, statusId: destination, category: target.category },
    ),
  ]);
}

export async function setTeamCreation(db: D1Database, actor: string, membersMayCreate: boolean) {
  const ctx = await administrationContext(db, actor);
  const previous=await ctx.db.prepare("SELECT member_team_creation FROM workspace_settings WHERE id=?").bind(ctx.workspace).first<number>("member_team_creation");
  if (previous===Number(membersMayCreate)) return;
  await commit(ctx,[
    guard(ctx.db,"EXISTS(SELECT 1 FROM operators WHERE id=? AND role IN('owner','admin') AND removed_at IS NULL)",actor),
    guard(ctx.db,"EXISTS(SELECT 1 FROM workspace_settings WHERE id=? AND member_team_creation=?)",ctx.workspace,previous!),
    ctx.db.prepare("UPDATE workspace_settings SET member_team_creation=?,updated_at=? WHERE id=?").bind(Number(membersMayCreate),ctx.at,ctx.workspace),
    ...audit(ctx,"workspace.team_creation_changed",ctx.workspace,"Team creation",{membersMayCreate:previous===1},{membersMayCreate}),
  ]);
}
