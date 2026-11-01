import { visibleDirectoryPerson } from '../roles/visibility-sql';
import seed from "../../../../seed.json";
import type { WorkspaceOptions } from "../../shared/workspace-options";
import { searchAdmission, SearchAccessError, type SearchFence } from "./access";

// Bounded configuration tables only: options never reads issues, comments,
// evidence, activity, notifications or a workspace snapshot.
export async function getSearchOptions(
  db: D1Database,
  operatorId: string,
  fence?: SearchFence,
): Promise<WorkspaceOptions> {
  const admission = await searchAdmission(db, operatorId, fence);
  const row = await db
    .prepare(
      `SELECT w.id,w.name,actor.role,w.member_label_creation AS memberLabelCreation,
    (SELECT json_group_array(json_object('id',id,'name',name,'identifierPrefix',identifier_prefix,'cyclesEnabled',json(CASE WHEN cycles_enabled=1 THEN 'true' ELSE 'false' END))) FROM (
      SELECT id,name,identifier_prefix,cycles_enabled FROM teams WHERE workspace_id=actor.workspace_id AND archived_at IS NULL ORDER BY name,id LIMIT ${seed.limits.teams}
    )) AS teams,
    (SELECT json_group_array(json_object('id',id,'name',name,'role',role)) FROM (
      SELECT directory.id,directory.name,directory.role FROM operators directory WHERE directory.workspace_id=actor.workspace_id AND directory.removed_at IS NULL AND ${visibleDirectoryPerson('directory','actor.id')} ORDER BY name,id LIMIT ${seed.limits.operators}
    )) AS operators,
    (SELECT json_group_array(json_object('id',id,'name',name,'color',color)) FROM (
      SELECT id,name,color FROM labels WHERE workspace_id=actor.workspace_id ORDER BY name,id LIMIT ${seed.limits.labels}
    )) AS labels,
    (SELECT json_group_array(json_object('id',id,'name',name,'lifecycle',lifecycle)) FROM (
      SELECT id,name,lifecycle FROM projects WHERE workspace_id=actor.workspace_id AND archived_at IS NULL ORDER BY name,id LIMIT ${seed.limits.projects}
    )) AS projects,
    (SELECT json_group_array(json_object('id',id,'projectId',project_id,'name',name,'completed',json(CASE WHEN completed=1 THEN 'true' ELSE 'false' END))) FROM (
      SELECT m.id,m.project_id,m.name,m.completed FROM project_milestones m JOIN projects p ON p.id=m.project_id
      WHERE p.workspace_id=actor.workspace_id AND p.archived_at IS NULL ORDER BY m.project_id,m.position,m.id
    )) AS milestones,
    (SELECT json_group_array(json_object('id',id,'teamId',team_id,'name',name,'category',category,'position',position)) FROM (
      SELECT s.id,s.team_id,s.name,s.category,s.position FROM workflow_statuses s JOIN teams t ON t.id=s.team_id
      WHERE t.workspace_id=actor.workspace_id AND t.archived_at IS NULL ORDER BY s.team_id,s.position,s.id LIMIT 5000
    )) AS statuses,
    (SELECT json_group_array(json_object('id',id,'teamId',team_id,'name',name,'startsAt',starts_at,'endsAt',ends_at)) FROM (
      SELECT c.id,c.team_id,c.name,c.starts_at,c.ends_at FROM cycles c JOIN teams t ON t.id=c.team_id
      WHERE t.workspace_id=actor.workspace_id AND t.archived_at IS NULL AND t.cycles_enabled=1 AND c.closed_at IS NULL
      ORDER BY c.starts_at,c.id LIMIT ${seed.limits.teams * seed.limits.cyclesPerTeam}
    )) AS cycles,
    (SELECT json_group_array(json_object('id',id,'name',name,'surface',surface,'isShared',json(CASE WHEN is_shared=1 THEN 'true' ELSE 'false' END))) FROM (
      SELECT id,name,surface,is_shared FROM saved_views WHERE workspace_id=actor.workspace_id
      AND (is_shared=1 OR owner_operator_id=actor.id) ORDER BY name,id LIMIT ${seed.limits.operators * seed.limits.savedViewsPerOperator}
    )) AS savedViews
    FROM operators actor JOIN workspace_settings w ON w.id=actor.workspace_id WHERE ${admission.sql}`,
    )
    .bind(...admission.values)
    .first<{
      id: string;
      name: string;
      memberLabelCreation: number;
      role: import("../roles/matrix").Role;
      teams: string;
      operators: string;
      labels: string;
      projects: string;
      milestones: string;
      statuses: string;
      cycles: string;
      savedViews: string;
    }>();
  if (!row) throw new SearchAccessError();
  return {
    workspace: { id: row.id, name: row.name },
    operator: { id: operatorId, role:row.role },
    labelsPerIssue: seed.limits.labelsPerIssue,
    canCreateLabels: row.role === "owner" || row.role === "admin" || row.role === "member" && row.memberLabelCreation === 1,
    savedViewsPerOperator: seed.limits.savedViewsPerOperator,
    bulkEditIssuesPerOperation: seed.limits.bulkEditIssuesPerOperation,
    teams: JSON.parse(row.teams),
    operators: JSON.parse(row.operators),
    labels: JSON.parse(row.labels),
    projects: JSON.parse(row.projects),
    milestones: JSON.parse(row.milestones),
    statuses: JSON.parse(row.statuses),
    cycles: JSON.parse(row.cycles),
    savedViews: JSON.parse(row.savedViews),
  };
}
