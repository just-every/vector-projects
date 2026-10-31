/** ROLE-002/003: shared row visibility, evaluated in the statement's SQL snapshot.
 * Explicit main.* references are policy inputs; ordinary repositories use the
 * CTE names and therefore scope BEFORE joins, aggregates, ranking and paging.
 * No role or membership is copied into a session or bearer token.
 */
export const visibleTeam = (person: string, team: string) =>
  `EXISTS(SELECT 1 FROM main.teams visible_team WHERE visible_team.id=${team} AND visible_team.workspace_id=${person}.workspace_id AND (${person}.role='owner' OR EXISTS(SELECT 1 FROM main.team_members visible_member WHERE visible_member.operator_id=${person}.id AND visible_member.team_id=visible_team.id) OR (${person}.role<>'guest' AND visible_team.is_private=0)))`

/** Explicit request exposure is directory metadata, never content membership. */
export const requestableTeam=(person:string,team:string)=>`(${person}.role IN('owner','admin','member') AND EXISTS(SELECT 1 FROM main.teams request_team WHERE request_team.id=${team} AND request_team.workspace_id=${person}.workspace_id AND request_team.requests_enabled=1 AND request_team.archived_at IS NULL))`

const guest = `(SELECT role FROM __vector_reader)='guest'`
const restricted = '(SELECT restricted FROM __vector_access)'
const scoped = (table: string, where: string) => `${table} AS (SELECT ${['issue_activity','issue_description_revisions'].includes(table) ? 'r.rowid AS rowid,' : ''}r.* FROM main.${table} r WHERE ${where})`
const issue = (column = 'issue_id') => `r.${column} IN (SELECT id FROM issues)`
const team = (column = 'team_id') => `r.${column} IN (SELECT id FROM teams)`
const project = (column = 'project_id') => `r.${column} IN (SELECT id FROM projects)`
/** Relation history must not disclose a now-hidden issue through its retained
 * identifier, nor a hidden project/team through its historical JSON. */
const safeHistory = (column: string) => `NOT EXISTS(SELECT 1 FROM json_tree(r.${column}) j JOIN __vector_hidden_refs hidden ON hidden.ref=j.value WHERE j.type='text')`

export function visibilityCtes(actor: string) {
  // The actor comes from native admission, never from SQL supplied by a client.
  // A SQL literal avoids changing repository positional/numbered bindings.
  const literal = "'" + actor.replaceAll("'", "''") + "'"
  return [
    `__vector_reader AS (SELECT id,workspace_id,role FROM main.operators WHERE id=${literal} AND removed_at IS NULL)`,
    `teams AS (SELECT t.* FROM main.teams t JOIN __vector_reader reader ON reader.workspace_id=t.workspace_id WHERE ${visibleTeam('reader', 't.id')})`,
    `__vector_access AS (SELECT reader.role='guest' OR EXISTS(SELECT 1 FROM main.teams hidden WHERE hidden.workspace_id=reader.workspace_id AND hidden.id NOT IN(SELECT id FROM teams)) AS restricted FROM __vector_reader reader)`,
    `operators AS (SELECT r.id,r.workspace_id,CASE WHEN r.role='guest' THEN r.name||' (Guest)' ELSE r.name END name,r.email,r.removed_at,r.created_at,r.updated_at,r.role
      FROM main.operators r JOIN __vector_reader reader ON reader.workspace_id=r.workspace_id)`,
    scoped('issues', team()),
    scoped('projects', `r.workspace_id=(SELECT workspace_id FROM __vector_reader) AND (EXISTS(SELECT 1 FROM issues i WHERE i.project_id=r.id) OR (NOT (${guest}) AND NOT EXISTS(SELECT 1 FROM main.issues i WHERE i.project_id=r.id)))`),
    `__vector_hidden_refs AS (SELECT id AS ref FROM main.issues WHERE id NOT IN(SELECT id FROM issues) UNION SELECT identifier FROM main.issues WHERE id NOT IN(SELECT id FROM issues) UNION SELECT id FROM main.teams WHERE id NOT IN(SELECT id FROM teams) UNION SELECT id FROM main.projects WHERE id NOT IN(SELECT id FROM projects))`,
    ...['workflow_statuses', 'cycles', 'team_members', 'team_departures', 'team_cycle_schedules', 'team_triage_rotations', 'team_triage_rotation_members', 'team_housekeeping', 'subissue_team_rules'].map(t => scoped(t, team())),
    scoped('team_join_requests', `${team()} OR r.requester_id=${literal}`),
    ...['issue_labels', 'evidence_revisions', 'intake_decisions', 'issue_comments', 'issue_reactions', 'issue_files', 'issue_links', 'issue_followers', 'issue_mentions', 'issue_notification_mutes', 'issue_reminders', 'notification_snoozes', 'issue_description_revisions', 'triage_creation_receipts'].map(t => scoped(t, issue())),
    `notifications AS (SELECT r.id,r.event_id,r.issue_id,r.recipient_id,r.actor_id,
      COALESCE((SELECT name FROM operators o WHERE o.id=r.actor_id),r.actor_name) actor_name,
      r.causes_json,r.created_at,r.read_at FROM main.notifications r WHERE ${issue()})`,
    scoped('issue_parents', `${issue()} AND ${issue('parent_issue_id')}`),
    scoped('issue_dependencies', `${issue('blocked_issue_id')} AND ${issue('blocking_issue_id')}`),
    scoped('issue_relations', `${issue('first_issue_id')} AND ${issue('second_issue_id')}`),
    scoped('issue_deletions', `r.workspace_id=(SELECT workspace_id FROM __vector_reader) AND ((SELECT role FROM __vector_reader)='owner' OR ${team()})`),
    scoped('issue_duplicates', `${issue()} AND ${issue('canonical_issue_id')}`),
    // Membership subqueries keep the same live source policy without the extra
    // correlated predicate depth inside the import kit's packed native guards.
    `issue_activity AS (SELECT r.rowid AS rowid,r.* FROM main.issue_activity r WHERE
      ((r.kind<>'issue.mentioned' OR json_extract(r.next_value_json,'$.sourceIssueId') IN(SELECT id FROM issues)
        OR json_extract(r.next_value_json,'$.sourceDocumentId') IN(SELECT id FROM documents)) AND ${issue()})
      AND (${safeHistory('previous_value_json')} AND ${safeHistory('next_value_json')}))`,
    ...['project_labels', 'project_milestones'].map(t => scoped(t, project())),
    scoped('project_activity', `${project()} AND ${safeHistory('previous_value_json')} AND ${safeHistory('next_value_json')}`),
    scoped('project_membership_events', `${project()} AND (NOT (${restricted}) OR r.identifier IN(SELECT identifier FROM issues) OR r.identifier IN(SELECT identifier FROM issue_deletions))`),
    scoped('cycle_membership_events', `r.cycle_id IN(SELECT id FROM cycles) AND (NOT (${restricted}) OR r.identifier IN(SELECT identifier FROM issues) OR r.identifier IN(SELECT identifier FROM issue_deletions))`),
    // Aggregate-only history cannot be divided into teams. Guest reports build
    // from visible live facts instead of presenting another team's totals.
    ...['project_report_days', 'project_report_snapshots', 'cycle_report_days'].map(t => scoped(t, `NOT (${restricted})`)),
    scoped('cycle_snapshots', `r.cycle_id IN(SELECT id FROM cycles) AND ${safeHistory('body_json')}`),
    scoped('cycle_closure_failures', `r.cycle_id IN(SELECT cycle_id FROM cycle_snapshots)`),
    scoped('saved_views', `r.workspace_id=(SELECT workspace_id FROM __vector_reader) AND (r.owner_operator_id=${literal} OR r.is_shared=1) AND CASE
      WHEN COALESCE(json_extract(r.filters_json,'$.team'),'all')='all' THEN NOT (${guest}) OR (r.is_shared=0 AND r.owner_operator_id=${literal}) OR NOT EXISTS(SELECT 1 FROM main.teams t JOIN __vector_reader reader ON reader.workspace_id=t.workspace_id WHERE t.id NOT IN(SELECT id FROM teams))
      ELSE json_extract(r.filters_json,'$.team') IN(SELECT id FROM teams) END
      AND (json_extract(r.filters_json,'$.project') IS NULL OR json_extract(r.filters_json,'$.project') IN('all','none') OR json_extract(r.filters_json,'$.project') IN(SELECT id FROM projects))`),
    scoped('project_templates', 'r.workspace_id=(SELECT workspace_id FROM __vector_reader) AND (r.team_id IS NULL OR r.team_id IN(SELECT id FROM teams))'),
    ...['project_template_milestones','project_template_labels','project_template_issues'].map(t=>scoped(t,'r.template_id IN(SELECT id FROM project_templates)')),
    scoped('dashboards', 'r.workspace_id=(SELECT workspace_id FROM __vector_reader) AND (r.team_id IS NULL OR r.team_id IN(SELECT id FROM teams))'),
    scoped('dashboard_widgets', 'r.dashboard_id IN(SELECT id FROM dashboards)'),
    scoped('initiative_projects', 'r.project_id IN(SELECT id FROM projects)'),
    scoped('documents', `r.workspace_id=(SELECT workspace_id FROM __vector_reader) AND (
      (r.parent_kind='issue' AND r.parent_id IN(SELECT id FROM issues)) OR
      (r.parent_kind='project' AND r.parent_id IN(SELECT id FROM projects)) OR
      (r.parent_kind='team' AND r.parent_id IN(SELECT id FROM teams)) OR
      (r.parent_kind='initiative' AND NOT (${guest}) AND r.parent_id IN(SELECT id FROM main.initiatives WHERE workspace_id=(SELECT workspace_id FROM __vector_reader))))`),
    ...['document_revisions','document_comments'].map(t=>scoped(t,'r.document_id IN(SELECT id FROM documents)')),
    scoped('document_issue_references', 'r.document_id IN(SELECT id FROM documents) AND r.target_issue_id IN(SELECT id FROM issues)'),
    scoped('issue_specifications', 'r.issue_id IN(SELECT id FROM issues) AND r.document_id IN(SELECT id FROM documents)'),
  ].join(',\n')
}

export const visibleDirectoryPerson = (person: string, actor: string) => `EXISTS(SELECT 1 FROM main.operators directory_reader WHERE directory_reader.id=${actor} AND directory_reader.removed_at IS NULL
  AND directory_reader.workspace_id=${person}.workspace_id AND (directory_reader.role<>'guest' OR ${person}.id=directory_reader.id
  OR EXISTS(SELECT 1 FROM main.team_members them JOIN main.team_members mine ON mine.team_id=them.team_id WHERE them.operator_id=${person}.id AND mine.operator_id=directory_reader.id)))`
